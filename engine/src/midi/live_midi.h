// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file live_midi.h
 * @brief L'entree MIDI live entre le monde exterieur et le thread audio.
 *
 * LA REGLE : un ring de plugin n'a qu'UN producteur, le thread audio. Le
 * MIDI qui vient d'un clavier (thread WinMM, ou demain le reseau) n'ecrit
 * JAMAIS un ring de plugin. Il ecrit CETTE file SPSC (producteur = la
 * source, consommateur = le callback audio) ; le callback la draine une
 * fois par sous-bloc de 256 et le graphe route les evenements vers
 * l'instrument de la piste cible (AudioGraph::setLiveMidi -> process).
 *
 * Latence mesuree ici = latence de FILE (t_push -> drain par le callback),
 * PAS clavier -> oreille : le pipeline (profondeur proxy + periode device)
 * s'y ajoute, le CLI l'affiche a cote pour que le total ait un sens.
 *
 * RT-safe : RingBuffer lock-free (push cote source, pop cote audio), des
 * atomics relaxed pour les compteurs. Plein = le push echoue et
 * dropped_full compte - la source ne stalle jamais, le callback non plus.
 */

#include "../audio/ring_buffer.h"
#include "../host/shared_audio_ring.h"

#include <atomic>
#include <cstdint>
#include <type_traits>

namespace daw::midi {

struct LiveMidiEvent {
    daw::host::MidiEvent ev;
    int64_t t_push_ns = 0;  // steady_clock au push (cote source)
};
static_assert(std::is_trivially_copyable_v<LiveMidiEvent>,
              "LiveMidiEvent traverse un RingBuffer : trivially copyable");

/** 512 evenements de marge : un accord plaque en fait ~10, une rafale de
 *  CC de molette ~100/s. Au-dela, la source jette et compte. */
using LiveMidiQueue = daw::audio::RingBuffer<LiveMidiEvent, 512>;

/** Compteurs lock-free, ecrits par le callback (et dropped_full par la
 *  source), lus par le thread de controle pour le log / la telemetrie. */
struct LiveMidiStats {
    std::atomic<uint64_t> drained{0};       // sortis de la file par le callback
    std::atomic<uint64_t> forwarded{0};     // pousses vers un instrument
    std::atomic<uint64_t> unrouted{0};      // jetes : pas de cible / piste muette
    std::atomic<uint64_t> dropped_full{0};  // refuses au push (file pleine)
    std::atomic<int64_t> lat_last_ns{0};    // latence de file du dernier draine
    std::atomic<int64_t> lat_max_ns{0};     // pire latence de file vue
};

/** Plafond d'evenements routes par sous-bloc (au-dela : le reste attend
 *  le sous-bloc suivant, 5,3 ms plus tard - jamais perdu). */
inline constexpr uint32_t kLiveMidiMaxPerBlock = 64;

/**
 * Draine <= max evenements (thread audio, consommateur unique). Mesure la
 * latence de file avec now_ns (steady_clock lu UNE fois par sous-bloc par
 * l'appelant). Retourne le nombre copie dans out.
 */
inline uint32_t drainLiveMidi(LiveMidiQueue& queue, LiveMidiStats* stats,
                              int64_t now_ns, daw::host::MidiEvent* out,
                              uint32_t max) noexcept {
    uint32_t n = 0;
    int64_t last = 0;
    int64_t worst = stats ? stats->lat_max_ns.load(std::memory_order_relaxed) : 0;
    while (n < max) {
        auto item = queue.pop();
        if (!item) break;
        out[n++] = item->ev;
        last = now_ns - item->t_push_ns;
        if (last > worst) worst = last;
    }
    if (n > 0 && stats) {
        stats->drained.fetch_add(n, std::memory_order_relaxed);
        stats->lat_last_ns.store(last, std::memory_order_relaxed);
        stats->lat_max_ns.store(worst, std::memory_order_relaxed);
    }
    return n;
}

}  // namespace daw::midi
