// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file tempo.h
 * @brief LE NOYAU TEMPO (migration T1) - moitie C++ du MIROIR EXACT
 * avec web/src/document/tempo.ts. Toute divergence casserait le
 * determinisme inter-pairs : les deux implementations sont verifiees
 * par LES MEMES vecteurs d'or (fixtures/tempo-vectors.json).
 *
 * ARITHMETIQUE 100 % ENTIERE (int64 ici, BigInt en TS) - pas de
 * doubles, pas de FMA, pas de libm : bit-identique PAR CONSTRUCTION.
 * Le noyau tourne au rebuild/geste, JAMAIS dans le callback audio.
 *
 * Unites : tick (PPQ 960 par noire), milliBpm (int, 20000..999000),
 * carte PIECEWISE-CONSTANT (les rampes viendront en additif).
 * Sens canonique : ticks -> samples (samplesAtTick) ; l'inverse est
 * UI-only. Arrondi canonique unique roundDiv (half-up, domaine
 * positif). Integration par TABLE DE FRONTIERES : l'arrondi a lieu une
 * fois par segment + une fois pour la queue - erreur bornee a 0,5
 * sample par breakpoint, identique chez tous les pairs.
 */

#include <algorithm>
#include <cstdint>
#include <vector>

namespace daw::tempo {

inline constexpr int64_t kPPQ = 960;
inline constexpr int64_t kMinMilliBpm = 20000;
inline constexpr int64_t kMaxMilliBpm = 999000;
// Garde d'overflow de segSamples (dt*sr*125*2 doit tenir dans int64
// jusqu'a sr=192k) : 2^36 ticks ~ 414 jours de timeline @120 BPM.
inline constexpr int64_t kMaxTick = int64_t(1) << 36;

struct TempoPoint {
    int64_t tick = 0;
    int64_t milli_bpm = 120000;
};

/** Division entiere arrondie half-up, domaine positif. LA definition. */
inline int64_t roundDiv(int64_t num, int64_t den) {
    // num >= 0, den > 0 - asserte par les appelants (bornes kMaxTick) ;
    // 2*dt*sr*125 avec dt <= 2^36 et sr <= 192k tient dans int64.
    return (2 * num + den) / (2 * den);
}

/** Samples d'un intervalle de dt ticks a tempo constant :
 *  roundDiv(dt * sr * 125, 2 * milliBpm). 960 ticks @48k/120000 = 24000. */
inline int64_t segSamples(int64_t dt_ticks, int64_t sample_rate,
                          int64_t milli_bpm) {
    return roundDiv(dt_ticks * sample_rate * 125, 2 * milli_bpm);
}

inline int64_t clampMilliBpm(int64_t v) {
    return std::max(kMinMilliBpm, std::min(kMaxMilliBpm, v));
}

/** Carte effective : la map si non vide (breakpoint implicite a 0 au
 *  registre si elle ne commence pas a 0), sinon le registre seul. */
inline std::vector<TempoPoint> effectiveMap(
    int64_t tempo_milli_bpm, const std::vector<TempoPoint>& tempo_map) {
    const int64_t reg = clampMilliBpm(tempo_milli_bpm);
    if (tempo_map.empty()) return {{0, reg}};
    std::vector<TempoPoint> map;
    map.reserve(tempo_map.size() + 1);
    if (tempo_map.front().tick != 0) map.push_back({0, reg});
    for (const auto& p : tempo_map) {
        map.push_back({p.tick, clampMilliBpm(p.milli_bpm)});
    }
    return map;
}

/** TABLE DE FRONTIERES : S[j] = samples cumules au breakpoint j.
 *  C'est LA spec (l'arrondi une fois par segment). */
inline std::vector<int64_t> buildBoundaryTable(
    const std::vector<TempoPoint>& map, int64_t sample_rate) {
    std::vector<int64_t> S{0};
    S.reserve(map.size());
    for (size_t j = 1; j < map.size(); ++j) {
        S.push_back(S[j - 1] + segSamples(map[j].tick - map[j - 1].tick,
                                          sample_rate, map[j - 1].milli_bpm));
    }
    return S;
}

/** Position sample CANONIQUE d'un tick (le sens qui fait foi).
 *  Fonction TOTALE : l'entree est clampee a [0, kMaxTick] - le miroir
 *  TS clampe IDENTIQUEMENT (jamais une exception d'un seul cote). */
inline int64_t samplesAtTick(const std::vector<TempoPoint>& map,
                             const std::vector<int64_t>& S,
                             int64_t sample_rate, int64_t tick) {
    tick = std::max(int64_t(0), std::min(kMaxTick, tick));
    size_t j = 0;
    while (j + 1 < map.size() && map[j + 1].tick <= tick) ++j;
    return S[j] + segSamples(tick - map[j].tick, sample_rate,
                             map[j].milli_bpm);
}

/** Inverse UI-only (regle/pointeur) - round-trip au demi-tick pres,
 *  jamais une source de persistance. */
inline int64_t tickAtSample(const std::vector<TempoPoint>& map,
                            const std::vector<int64_t>& S,
                            int64_t sample_rate, int64_t sample) {
    sample = std::max(int64_t(0), sample);
    size_t j = 0;
    while (j + 1 < S.size() && S[j + 1] <= sample) ++j;
    const int64_t out = map[j].tick +
        roundDiv((sample - S[j]) * 2 * map[j].milli_bpm, sample_rate * 125);
    return std::min(kMaxTick, out);  // clamp, miroir du TS
}

}  // namespace daw::tempo
