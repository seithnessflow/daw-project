// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file proxy_depth.h
 * @brief Le CONTRAT DE PERIODE cote hote (A3-2 / A3-3, 2026-08-28).
 *
 * La profondeur du pipeline plugin = blocs de 256 par callback device
 * (ceil(period / 256)). Le ring en supporte au plus kRingSlots - 2 (une
 * marge d'ecriture, une marge de lecture). Hors contrat, on ne clampe
 * PLUS en silence (famille des 47 runs : une promesse de prose que le
 * code ne tenait pas) ni meme bruyamment (v10) : on REFUSE de demarrer,
 * avec la sortie (reduire --buffer-size, ou bump kLayoutVersion avec plus
 * de slots). Le refus vit ici, une seule fois, pour les deux chemins de
 * main.cpp (fichier et serveur) et pour le gtest.
 */

#include "shared_audio_ring.h"

#include <cstdint>
#include <optional>
#include <string>

namespace daw::host {

/** Profondeur maximale que le ring courant supporte. */
inline constexpr uint32_t kMaxProxyDepth = kRingSlots - 2;

/** ceil(period / 256), ou nullopt si le ring ne peut pas la porter. */
inline std::optional<uint32_t> proxyDepthFor(uint32_t period_frames) noexcept {
    const uint32_t needed =
        (period_frames + kRingBlockSize - 1) / kRingBlockSize;
    if (needed > kMaxProxyDepth) return std::nullopt;
    return needed < 1 ? 1u : needed;
}

/** Le message du refus - une seule redaction. */
inline std::string proxyDepthRefusal(uint32_t period_frames) {
    const uint32_t needed =
        (period_frames + kRingBlockSize - 1) / kRingBlockSize;
    return "device period " + std::to_string(period_frames) +
           " frames needs a plugin pipeline depth of " +
           std::to_string(needed) + " blocks, the ring supports " +
           std::to_string(kMaxProxyDepth) + " (kRingSlots-2) - REFUSED "
           "(contrat de periode A3-2). Reduce --buffer-size (<= " +
           std::to_string(kMaxProxyDepth * kRingBlockSize) +
           ") or bump kLayoutVersion with more slots.";
}

}  // namespace daw::host
