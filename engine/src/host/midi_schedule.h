// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file midi_schedule.h
 * @brief Planification des notes vers un instrument, par bloc (v8 MIDI).
 *
 * Un node instrument (ProxyNode live / SyncProxyNode offline) porte une liste
 * de notes en positions ABSOLUES (samples sur la timeline). A chaque bloc
 * [pos, pos+n), on emet un note-on pour toute note qui COMMENCE dans le bloc
 * et un note-off pour toute note qui SE TERMINE dans le bloc, au sample pres
 * (sampleOffset = position - pos). Stateless par bloc : pas d'etat de note a
 * traquer entre blocs (on teste juste l'appartenance start/end au bloc).
 *
 * Piege connu (dette assumee, minimal slice) : un SEEK/LOOP peut sauter le
 * note-off d'une note en cours -> note bloquee. Le correctif propre = un
 * all-notes-off au saut de transport ; a ajouter quand le transport bougera.
 */

#include <cstdint>
#include <vector>

namespace daw::host {

struct ScheduledNote {
    uint8_t pitch = 60;
    uint8_t velocity = 100;
    int64_t start = 0;  // sample absolu du note-on
    int64_t end = 0;    // sample absolu du note-off (start + longueur)
};

/**
 * Emet les evenements du bloc via `emit(bool note_on, uint8_t pitch,
 * uint8_t velocity, uint32_t sample_offset)`. RT-safe si `emit` l'est.
 */
template <class EmitFn>
inline void emitBlockNotes(const std::vector<ScheduledNote>& notes, int64_t pos,
                           uint32_t frames, EmitFn&& emit) {
    const int64_t block_end = pos + static_cast<int64_t>(frames);
    for (const auto& nt : notes) {
        if (nt.start >= pos && nt.start < block_end) {
            emit(true, nt.pitch, nt.velocity,
                 static_cast<uint32_t>(nt.start - pos));
        }
        if (nt.end >= pos && nt.end < block_end) {
            emit(false, nt.pitch, static_cast<uint8_t>(0),
                 static_cast<uint32_t>(nt.end - pos));
        }
    }
}

}  // namespace daw::host
