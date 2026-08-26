// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file stage_probe.h
 * @brief PREUVE AUDIO PAR ETAGE (demande utilisateur 2026-08-27) : mesurer
 * et EMPREINTER le signal ENTRE CHAQUE maillon de chaque piste - clips ->
 * gain -> chaque plugin -> pan -> master.
 *
 * Trois nombres par etage, accumules sur TOUT le rendu :
 *  - peak (max |sample|) : le niveau crete de l'etage ;
 *  - rms (sqrt(somme des carres / n)) : l'energie moyenne ;
 *  - hash FNV-1a 64 du flux d'octets float : l'EMPREINTE. Deux rendus (deux
 *    machines, deux jours) qui donnent le meme hash ont produit les MEMES
 *    octets a cet etage - c'est la meme philosophie que la cle de stem, au
 *    grain de l'etage. Un hash qui differe DIT ou l'audio a change.
 *
 * OFFLINE UNIQUEMENT : le pointeur est nul en live (un `if` par etage,
 * zero cout) ; en rendu, allocations et map autorisees (pas de thread
 * audio sacre). Le diagnostic qui a motive l'outil : 4 pistes muettes,
 * une heure de soupcons (plugins ? assets ? formats ?) - la preuve par
 * etage aurait montre "clips: signal, gain: SILENCE" en une lecture
 * (les faders etaient a zero dans le document).
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace daw::graph {

struct StageStats {
    double sum_sq = 0.0;
    uint64_t samples = 0;
    float peak = 0.0f;
    uint64_t fnv = 1469598103934665603ULL;  // offset basis FNV-1a 64

    void feed(const float* buf, uint32_t frames) {
        const uint32_t n = frames * 2;  // stereo entrelace
        for (uint32_t i = 0; i < n; ++i) {
            const float s = buf[i];
            const float a = std::fabs(s);
            if (a > peak) peak = a;
            sum_sq += static_cast<double>(s) * static_cast<double>(s);
            // FNV-1a sur les 4 octets du float (empreinte exacte du flux)
            uint32_t bits;
            static_assert(sizeof(bits) == sizeof(s), "float 32 bits");
            std::memcpy(&bits, &s, sizeof(bits));
            for (int b = 0; b < 4; ++b) {
                fnv ^= (bits >> (b * 8)) & 0xFFu;
                fnv *= 1099511628211ULL;
            }
        }
        samples += n;
    }

    [[nodiscard]] double rmsDb() const {
        if (samples == 0) return -120.0;
        const double rms = std::sqrt(sum_sq / static_cast<double>(samples));
        return rms > 1e-6 ? 20.0 * std::log10(rms) : -120.0;
    }
    [[nodiscard]] double peakDb() const {
        return peak > 1e-6 ? 20.0 * std::log10(static_cast<double>(peak)) : -120.0;
    }
};

/**
 * Les etages d'une piste, DANS L'ORDRE du chemin audio. La cle d'etage est
 * stable et parlante : "clips", "gain", l'id du node de chaine (l'id du
 * document - le meme chez tous les pairs), "pan" ; piste "__master__" pour
 * l'etage master. L'ordre d'arrivee est memorise (l'ordre du pipeline).
 */
class StageProbe {
public:
    void feed(const std::string& track_id, const std::string& stage,
              const float* buf, uint32_t frames) {
        const Key k{track_id, stage};
        auto it = stats_.find(k);
        if (it == stats_.end()) {
            order_.push_back(k);
            it = stats_.emplace(k, StageStats{}).first;
        }
        it->second.feed(buf, frames);
    }

    /** JSON lisible par ear : liste ordonnee d'etages avec mesures+hash. */
    [[nodiscard]] std::string toJson() const {
        std::string out = "[";
        bool first = true;
        char buf[256];
        for (const auto& k : order_) {
            const auto& s = stats_.at(k);
            std::snprintf(buf, sizeof(buf),
                "%s{\"track\":\"%s\",\"stage\":\"%s\",\"peak_dbfs\":%.2f,"
                "\"rms_dbfs\":%.2f,\"hash\":\"%016llx\",\"samples\":%llu}",
                first ? "" : ",", k.first.c_str(), k.second.c_str(),
                s.peakDb(), s.rmsDb(),
                static_cast<unsigned long long>(s.fnv),
                static_cast<unsigned long long>(s.samples));
            out += buf;
            first = false;
        }
        out += "]";
        return out;
    }

private:
    using Key = std::pair<std::string, std::string>;
    std::map<Key, StageStats> stats_;
    std::vector<Key> order_;
};

}  // namespace daw::graph
