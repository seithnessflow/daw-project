// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * midi_send - envoie des messages MIDI sur un port de SORTIE (WinMM).
 * Outil de preuve pilotee de l'entree MIDI live (Vague 3) : avec un port
 * virtuel loopMIDI, ce qu'on envoie ici ressort sur le port d'ENTREE du
 * meme nom que le moteur a ouvert avec --midi-in.
 *
 *   midi_send --port <substr> [--channel 0] [--note 60] [--vel 100]
 *             [--hold-ms 400] [--cc <ctrl> <val>] [--bend <0..16383>]
 *
 * Sequence : CC (si donne) -> bend (si donne) -> note-on -> hold -> note-off.
 * Exit 0 = tout envoye ; 2 = port introuvable ; 1 = erreur WinMM/args.
 */

#include <windows.h>
#include <mmsystem.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <chrono>

static std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

static std::string toUtf8(const wchar_t* w) {
    const int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) return {};
    std::string s(static_cast<size_t>(n - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    return s;
}

static DWORD pack(unsigned status, unsigned d1, unsigned d2) {
    return (status & 0xFF) | ((d1 & 0x7F) << 8) | ((d2 & 0x7F) << 16);
}

int main(int argc, char** argv) {
    std::string port;
    int channel = 0, note = 60, vel = 100, hold_ms = 400;
    int cc = -1, ccv = 0, bend = -1;
    bool list = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&](int& out) { if (++i >= argc) { std::fprintf(stderr, "%s needs a value\n", a.c_str()); std::exit(1); } out = std::atoi(argv[i]); };
        if (a == "--port") { if (++i >= argc) { std::fprintf(stderr, "--port needs a name\n"); return 1; } port = argv[i]; }
        else if (a == "--list") list = true;
        else if (a == "--channel") next(channel);
        else if (a == "--note") next(note);
        else if (a == "--vel") next(vel);
        else if (a == "--hold-ms") next(hold_ms);
        else if (a == "--cc") { next(cc); next(ccv); }
        else if (a == "--bend") next(bend);
        else { std::fprintf(stderr, "unknown arg %s\n", a.c_str()); return 1; }
    }
    const UINT n = midiOutGetNumDevs();
    int index = -1;
    for (UINT i = 0; i < n; ++i) {
        MIDIOUTCAPSW caps{};
        if (midiOutGetDevCapsW(i, &caps, sizeof(caps)) != MMSYSERR_NOERROR) continue;
        const std::string name = toUtf8(caps.szPname);
        if (list) std::printf("  %u. %s\n", i + 1, name.c_str());
        if (index < 0 && !port.empty() && lower(name).find(lower(port)) != std::string::npos) {
            index = static_cast<int>(i);
        }
    }
    if (list) return 0;
    if (port.empty()) { std::fprintf(stderr, "--port <substr> required (--list to see ports)\n"); return 1; }
    if (index < 0) { std::fprintf(stderr, "no MIDI output port matches \"%s\"\n", port.c_str()); return 2; }

    HMIDIOUT h = nullptr;
    if (midiOutOpen(&h, static_cast<UINT>(index), 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
        std::fprintf(stderr, "midiOutOpen failed\n");
        return 1;
    }
    const unsigned ch = static_cast<unsigned>(channel & 0x0F);
    if (cc >= 0) midiOutShortMsg(h, pack(0xB0 | ch, static_cast<unsigned>(cc), static_cast<unsigned>(ccv)));
    if (bend >= 0) midiOutShortMsg(h, pack(0xE0 | ch, static_cast<unsigned>(bend & 0x7F), static_cast<unsigned>((bend >> 7) & 0x7F)));
    midiOutShortMsg(h, pack(0x90 | ch, static_cast<unsigned>(note), static_cast<unsigned>(vel)));
    std::this_thread::sleep_for(std::chrono::milliseconds(hold_ms));
    midiOutShortMsg(h, pack(0x80 | ch, static_cast<unsigned>(note), 0));
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    midiOutClose(h);
    std::printf("sent note %d vel %d ch %d hold %d ms%s%s\n", note, vel, channel, hold_ms,
                cc >= 0 ? " +cc" : "", bend >= 0 ? " +bend" : "");
    return 0;
}
