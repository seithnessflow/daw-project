// SPDX-License-Identifier: GPL-3.0-or-later
// Stub de MidiInput hors Windows (CI Linux) : aucun backend, refus en clair.

#include "midi_input.h"

namespace daw::midi {

std::vector<std::string> MidiInput::listDevices() { return {}; }

bool MidiInput::open(const std::string&, LiveMidiQueue*, LiveMidiStats*,
                     std::string& err) {
    err = "MIDI input: no backend on this platform (WinMM only for now)";
    return false;
}

void MidiInput::close() noexcept {}

void MidiInput::onShortMessage(uint32_t, int64_t) noexcept {}

}  // namespace daw::midi
