// SPDX-License-Identifier: GPL-3.0-or-later
// Backend WinMM de MidiInput (Windows seulement - voir midi_input.h).

#include "midi_input.h"
#include "midi_parse.h"

#include <windows.h>
#include <mmsystem.h>

#include <chrono>

namespace daw::midi {

namespace {

int64_t nowNs() noexcept {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
               std::chrono::steady_clock::now().time_since_epoch()).count();
}

std::string toUtf8(const wchar_t* w) {
    if (!w || !*w) return {};
    const int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) return {};
    std::string s(static_cast<size_t>(n - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    return s;
}

std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string mmError(MMRESULT r) {
    char buf[MAXERRORLENGTH] = {};
    if (midiInGetErrorTextA(r, buf, sizeof(buf)) == MMSYSERR_NOERROR) return buf;
    return "mmsystem error " + std::to_string(r);
}

// Le callback du driver : thread systeme, liste blanche d'appels WinMM
// minuscule. Ici : rien que parse + push + compteur.
void CALLBACK midiInProc(HMIDIIN, UINT msg, DWORD_PTR instance, DWORD_PTR p1, DWORD_PTR) {
    if (msg != MIM_DATA) return;  // MIM_LONGDATA (sysex) jamais prepare, donc jamais livre
    auto* self = reinterpret_cast<MidiInput*>(instance);
    if (self) self->onShortMessage(static_cast<uint32_t>(p1), nowNs());
}

}  // namespace

std::vector<std::string> MidiInput::listDevices() {
    std::vector<std::string> out;
    const UINT n = midiInGetNumDevs();
    for (UINT i = 0; i < n; ++i) {
        MIDIINCAPSW caps{};
        if (midiInGetDevCapsW(i, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
            out.push_back(toUtf8(caps.szPname));
        } else {
            out.push_back("(port " + std::to_string(i) + ")");
        }
    }
    return out;
}

bool MidiInput::open(const std::string& substring, LiveMidiQueue* queue,
                     LiveMidiStats* stats, std::string& err) {
    if (handle_) { err = "already open"; return false; }
    if (!queue) { err = "no queue"; return false; }
    const auto names = listDevices();
    const std::string want = lower(substring);
    int index = -1;
    for (size_t i = 0; i < names.size(); ++i) {
        if (lower(names[i]).find(want) != std::string::npos) { index = static_cast<int>(i); break; }
    }
    if (index < 0) {
        err = "no MIDI input port matches \"" + substring + "\" (" +
              std::to_string(names.size()) + " port(s); --list-midi-devices)";
        return false;
    }
    queue_ = queue;
    stats_ = stats;
    HMIDIIN h = nullptr;
    MMRESULT r = midiInOpen(&h, static_cast<UINT>(index),
                            reinterpret_cast<DWORD_PTR>(&midiInProc),
                            reinterpret_cast<DWORD_PTR>(this), CALLBACK_FUNCTION);
    if (r != MMSYSERR_NOERROR) {
        err = "midiInOpen(\"" + names[static_cast<size_t>(index)] + "\"): " + mmError(r);
        queue_ = nullptr; stats_ = nullptr;
        return false;
    }
    r = midiInStart(h);
    if (r != MMSYSERR_NOERROR) {
        err = "midiInStart: " + mmError(r);
        midiInClose(h);
        queue_ = nullptr; stats_ = nullptr;
        return false;
    }
    handle_ = h;
    name_ = names[static_cast<size_t>(index)];
    return true;
}

void MidiInput::close() noexcept {
    if (!handle_) return;
    HMIDIIN h = static_cast<HMIDIIN>(handle_);
    midiInStop(h);   // plus de callback apres le retour (la file survit a un dernier tir)
    midiInReset(h);
    midiInClose(h);
    handle_ = nullptr;
    queue_ = nullptr;
    stats_ = nullptr;
}

void MidiInput::onShortMessage(uint32_t packed, int64_t now_ns) noexcept {
    if (!queue_) return;
    LiveMidiEvent e;
    if (!parseMidiShort(packed, e.ev)) return;  // horloge, active sensing, aftertouch...
    e.t_push_ns = now_ns;
    if (!queue_->push(e) && stats_) {
        stats_->dropped_full.fetch_add(1, std::memory_order_relaxed);
    }
}

}  // namespace daw::midi
