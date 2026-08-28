// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file midi_parse.h
 * @brief Un message MIDI court (3 octets, format fil) -> MidiEvent du ring.
 *
 * Toutes plateformes, pure, testee sans materiel. Le mot 32 bits est celui
 * que WinMM livre en MIM_DATA (dwParam1) : octet 0 = statut, octet 1 =
 * data1, octet 2 = data2 - des messages COMPLETS, jamais de running status.
 * Retenu : note-off (0x8n), note-on (0x9n ; velocite 0 = note-off, la
 * convention du fil), control change (0xBn), pitch-bend (0xEn : LSB, MSB).
 * Refuse : aftertouch (0xAn/0xDn), program (0xCn), tout >= 0xF0 (0xF8
 * horloge et 0xFE active sensing ARRIVENT dans le callback et inonderaient
 * la file). Refuser = false, l'appelant ne pousse rien.
 */

#include "../host/shared_audio_ring.h"

#include <cstdint>

namespace daw::midi {

inline bool parseMidiShort(uint32_t packed, daw::host::MidiEvent& out) noexcept {
    const uint8_t status = static_cast<uint8_t>(packed & 0xFF);
    const uint8_t data1 = static_cast<uint8_t>((packed >> 8) & 0x7F);
    const uint8_t data2 = static_cast<uint8_t>((packed >> 16) & 0x7F);
    if (status >= 0xF0) return false;  // systeme : horloge, active sensing...
    const uint8_t kind = status & 0xF0;
    out.channel = status & 0x0F;
    out.data1 = data1;
    out.data2 = data2;
    out.sample_offset = 0;
    switch (kind) {
        case 0x80:
            out.kind = daw::host::MidiKind::NoteOff;
            return true;
        case 0x90:
            out.kind = data2 == 0 ? daw::host::MidiKind::NoteOff
                                  : daw::host::MidiKind::NoteOn;
            return true;
        case 0xB0:
            out.kind = daw::host::MidiKind::ControlChange;
            return true;
        case 0xE0:
            out.kind = daw::host::MidiKind::PitchBend;
            return true;
        default:
            return false;  // 0xA0 poly aftertouch, 0xC0 program, 0xD0 aftertouch
    }
}

}  // namespace daw::midi
