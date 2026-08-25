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
 *
 * F5 (launch Session) : emitSessionLoop ci-dessous joue un SLOT en BOUCLE
 * (horloge de session libre) - rebasage + wrap + all-notes-off a la couture,
 * le tout en ordre d'offset croissant (l'enfant draine le FIFO sans trier).
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

/**
 * F5 : emet un SLOT de session joue en BOUCLE pour le bloc [base, base+frames).
 * Les notes du slot sont en positions LOCALES [0, loop_len). base = horloge de
 * session - sample de lancement (rebasage). Le bloc peut franchir la couture de
 * boucle : on emet la fin de l'iteration courante, un ALL-NOTES-OFF (des pitches
 * du slot) a la couture pour ne laisser AUCUNE note bloquee, puis le debut de la
 * nouvelle iteration. Les evenements sortent en ORDRE d'offset croissant
 * (note-off avant note-on a offset egal) car l'enfant draine le FIFO sans trier.
 *
 * RT-safe : buffer fixe sur la pile, tri par insertion, aucune alloc. Hypothese
 * loop_len >= frames (un slot de session fait des milliers de samples ; un bloc
 * en fait 256) - garantie par construction, on ne gere pas la multi-couture.
 * emit(bool note_on, uint8_t pitch, uint8_t velocity, uint32_t sample_offset).
 */
template <class EmitFn>
inline void emitSessionLoop(const std::vector<ScheduledNote>& notes,
                            int64_t loop_len, int64_t base, uint32_t frames,
                            EmitFn&& emit) {
    if (loop_len <= 0) return;
    const int64_t local0 = ((base % loop_len) + loop_len) % loop_len;
    const int64_t block_end_local = local0 + static_cast<int64_t>(frames);
    const bool wraps = block_end_local > loop_len;
    const uint32_t wrap_off =
        wraps ? static_cast<uint32_t>(loop_len - local0) : frames;

    struct Ev { uint32_t offset; bool on; uint8_t pitch; uint8_t vel; };
    Ev buf[256];
    uint32_t n = 0;
    const auto add = [&](uint32_t off, bool on, uint8_t p, uint8_t v) {
        if (n < 256) buf[n++] = Ev{off, on, p, v};
    };

    // Iteration courante (k=0) et suivante (k=1, pour la queue apres la
    // couture). loop_len >= frames -> au plus une couture par bloc.
    for (const auto& nt : notes) {
        for (int k = 0; k < 2; ++k) {
            const int64_t on_local = nt.start + static_cast<int64_t>(k) * loop_len;
            if (on_local >= local0 && on_local < block_end_local) {
                add(static_cast<uint32_t>(on_local - local0), true, nt.pitch,
                    nt.velocity);
            }
            const int64_t off_local = nt.end + static_cast<int64_t>(k) * loop_len;
            if (off_local >= local0 && off_local < block_end_local) {
                add(static_cast<uint32_t>(off_local - local0), false, nt.pitch, 0);
            }
        }
    }
    // All-notes-off a la couture : coupe toute note encore tenue de l'iteration
    // qui s'acheve, AVANT les note-ons de la nouvelle (le tri place off<on).
    if (wraps) {
        for (const auto& nt : notes) add(wrap_off, false, nt.pitch, 0);
    }

    // Tri par insertion (n petit, RT-safe) : offset croissant, off avant on.
    for (uint32_t i = 1; i < n; ++i) {
        const Ev e = buf[i];
        int j = static_cast<int>(i) - 1;
        while (j >= 0 && (buf[j].offset > e.offset ||
                          (buf[j].offset == e.offset && buf[j].on && !e.on))) {
            buf[j + 1] = buf[j];
            --j;
        }
        buf[j + 1] = e;
    }
    for (uint32_t i = 0; i < n; ++i) {
        emit(buf[i].on, buf[i].pitch, buf[i].vel, buf[i].offset);
    }
}

}  // namespace daw::host
