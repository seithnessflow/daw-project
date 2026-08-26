// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file automation.h
 * @brief A2 : evaluation PURE des enveloppes d'automation.
 *
 * MIROIR EXACT de web/src/document/automation.ts (automationValueAt) - le
 * contrat d'exactitude entre les deux etages : meme clamp aux extremites,
 * meme interpolation lineaire, meme traitement des points confondus en t
 * (rendre le second, jamais diviser par zero). Toute divergence casserait
 * le determinisme inter-pairs ; les gtests assertent les memes cas que la
 * suite web. RT-safe : aucune alloc, lanes immuables une fois le graphe
 * construit.
 *
 * A2 evalue par SOUS-BLOC (256 frames) : la valeur au premier sample du
 * bloc tient tout le bloc. Les marches de ~5 ms sont inaudibles sur gain/
 * pan (multiplications directes) ; un lissage par sample viendra si une
 * enveloppe raide revele du zipper (dette datee, declencheur mesurable).
 */

#include "../document/schema.h"

#include <optional>

namespace daw::graph {

/**
 * Valeur de l'enveloppe a l'instant t (samples timeline).
 * nullopt = pas d'automation (lane disabled ou vide) - le consommateur
 * retombe sur l'etat manuel. Precondition : points tries par t.
 */
inline std::optional<float> automationValueAt(
    const daw::document::AutomationLaneDef& lane, int64_t t) noexcept {
    if (!lane.enabled) return std::nullopt;
    const auto& pts = lane.points;
    if (pts.empty()) return std::nullopt;
    if (t <= pts.front().t) return pts.front().v;
    if (t >= pts.back().t) return pts.back().v;
    for (size_t i = 1; i < pts.size(); ++i) {
        if (t < pts[i].t) {
            const auto& a = pts[i - 1];
            const auto& b = pts[i];
            const int64_t dt = b.t - a.t;
            if (dt <= 0) return b.v;  // points confondus : cf. miroir TS
            // Arithmetique en DOUBLE comme le miroir TS (f64), cast float
            // en sortie : les deux etages calculent la meme valeur.
            const double frac = static_cast<double>(t - a.t) /
                                static_cast<double>(dt);
            return static_cast<float>(
                static_cast<double>(a.v) +
                (static_cast<double>(b.v) - static_cast<double>(a.v)) * frac);
        }
    }
    return pts.back().v;  // inatteignable avec des points tries (garde)
}

/**
 * Valeur AUTOMATISEE d'un parametre de piste/master : cherche la premiere
 * lane enabled ciblant `param` SANS processor_id (les devices = A4), sinon
 * nullopt (le manuel reprend). v est ensuite MAPPE par l'appelant.
 */
inline std::optional<float> laneValueFor(
    const std::vector<daw::document::AutomationLaneDef>& lanes,
    const char* param, int64_t t) noexcept {
    for (const auto& lane : lanes) {
        if (!lane.processor_id.empty() || lane.param != param) continue;
        if (auto v = automationValueAt(lane, t)) return v;
    }
    return std::nullopt;
}

/** Mapping v normalise -> unites moteur (le document ne porte JAMAIS
 *  d'unite - AUTOMATION-DESIGN section 1). */
inline float mapGain(float v) noexcept { return v * 2.0f; }        // 0..1 -> 0..2
inline float mapPan(float v) noexcept { return v * 2.0f - 1.0f; }  // 0..1 -> -1..+1

}  // namespace daw::graph
