// SPDX-License-Identifier: GPL-3.0-or-later
#include "resolve_time.h"

#include "../graph/tempo.h"

namespace daw::document {

namespace {

using daw::tempo::TempoPoint;

std::vector<TempoPoint> docTempoMap(const ProjectDef& doc) {
    std::vector<TempoPoint> raw;
    raw.reserve(doc.tempo_map.size());
    for (const auto& p : doc.tempo_map) {
        raw.push_back({p.tick, p.milli_bpm});
    }
    const int64_t reg =
        doc.tempo_milli_bpm > 0 ? doc.tempo_milli_bpm : 120000;
    return daw::tempo::effectiveMap(reg, raw);
}

}  // namespace

void resolveMusicalTime(ProjectDef& doc) {
    if (doc.schema_version < 2) return;  // v1 pur : ZERO mutation

    const auto map = docTempoMap(doc);
    const auto S = daw::tempo::buildBoundaryTable(
        map, static_cast<int64_t>(doc.sample_rate));
    const int64_t sr = static_cast<int64_t>(doc.sample_rate);
    const auto at = [&](int64_t tick) {
        return daw::tempo::samplesAtTick(map, S, sr, tick);
    };

    for (auto& track : doc.tracks) {
        for (auto& clip : track.clips) {
            if (clip.isMusical()) {
                const int64_t cs = at(clip.start_tick);
                clip.start_sample = cs;
                if (clip.length_tick >= 0) {
                    // Duree = difference de positions (jamais un
                    // segSamples direct : l'adjacence sans couture)
                    clip.length_samples =
                        at(clip.start_tick + clip.length_tick) - cs;
                }
                // Notes musicales : relatives au clip, resolues sur la
                // timeline puis re-relativisees (le domaine du clip
                // parent gouverne - garde sanitize cote web).
                for (auto& n : clip.notes) {
                    if (n.start_tick < 0) continue;
                    const int64_t abs_start =
                        at(clip.start_tick + n.start_tick);
                    n.start_sample = abs_start - cs;
                    if (n.length_tick >= 0) {
                        n.length_samples =
                            at(clip.start_tick + n.start_tick +
                               n.length_tick) - abs_start;
                    }
                }
            }
        }
        for (auto& lane : track.automation) {
            if (!lane.time_base_ticks) continue;
            for (auto& pt : lane.points) pt.t = at(pt.t);
        }
    }
    for (auto& lane : doc.automation) {
        if (!lane.time_base_ticks) continue;
        for (auto& pt : lane.points) pt.t = at(pt.t);
    }
}

int64_t sessionQuantumSamples(const ProjectDef& doc) {
    if (doc.schema_version < 2) return 0;  // legacy : loop_len du slot
    int64_t num = 4;
    int64_t den = 4;
    for (const auto& sig : doc.time_signature) {
        if (sig.tick == 0 && sig.num >= 1 && sig.num <= 32 &&
            sig.den >= 1 && sig.den <= 32) {
            num = sig.num;
            den = sig.den;
            break;
        }
    }
    const int64_t bar_ticks = 4 * daw::tempo::kPPQ * num / den;
    const int64_t reg = daw::tempo::clampMilliBpm(
        doc.tempo_milli_bpm > 0 ? doc.tempo_milli_bpm : 120000);
    return daw::tempo::segSamples(
        bar_ticks, static_cast<int64_t>(doc.sample_rate), reg);
}

}  // namespace daw::document
