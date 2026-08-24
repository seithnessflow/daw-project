// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file graph_common.h
 * @brief Shared graph-construction pieces (S3, 2026-08-22).
 *
 * The live builder (main.cpp) and the offline builder (offline_render.cpp)
 * are INTENTIONALLY different in how they instantiate plugins - live uses
 * an async ProxyNode over a ring + an instance registry + server asset
 * fetch; offline uses a synchronous, bit-exact SyncProxyNode. That
 * divergence is a feature (two execution models), not a twin to merge.
 *
 * What WAS a dangerous twin - duplicated verbatim in both - is the clip
 * geometry (start/length/offset + asset load) and the gain-node param
 * extraction: exactly the fields that feed the deterministic render hash.
 * Those live here now, so a change to clip/gain construction cannot drift
 * between the two paths.
 */

#include "clip_player.h"
#include "compressor_node.h"
#include "eq3_node.h"
#include "gain_node.h"
#include "utility_node.h"
#include "../document/schema.h"

#include <functional>
#include <memory>
#include <string>

namespace daw::graph {

/**
 * Build a ClipPlayer from a document clip: copy the geometry, load the
 * asset by hash from assets_dir (cached), attach it if present. The
 * caller is responsible for making the asset file exist first (the live
 * path fetches from the server on a miss BEFORE calling this; offline
 * requires the file on disk).
 *
 * V1.6: resolves the clip's EFFECTIVE fades here (one place, both
 * builders): explicit field, or the implicit anti-click sample_rate/250
 * (= 4 ms, integer math) when the field is 0; each clamped to half the
 * clip length. Applying the implicit ramp UNCONDITIONALLY is sample-
 * exactly equivalent to "only when the edge cuts non-zero signal"
 * (ramping silence is identity) - so no content-dependent branch.
 */
ClipPlayer makeClipPlayer(const document::ClipDef& clip_def,
                          const std::string& assets_dir,
                          AssetCache& asset_cache,
                          uint32_t sample_rate);

/**
 * Build a GainNode from a "gain" chain node (non-bypassed). Returns the
 * node with the document's gain param (default 1.0 when absent).
 */
std::unique_ptr<GainNode> makeGainNode(const document::ProcessorDef& proc_def);

/**
 * Fabrique PARTAGEE des devices natifs (session 4.1) : UN dispatch
 * pour les builders live et offline (regle des jumeaux - le troisieme,
 * le clone d'audio_graph, reste par type faute de ProcessorDef).
 * nullptr = type builtin inconnu (le builder signale et suit son
 * chemin d'echec habituel).
 */
std::unique_ptr<ProcessorNode> makeBuiltinNode(const document::ProcessorDef& proc_def);

/**
 * S7 STEM SUBSTITUTION - the INVARIANT's reading half, decided in ONE
 * place for both builders (live and offline; the decision is exactly
 * the kind of twin that would drift).
 *
 * When a track's chain holds a vst3 node this machine cannot resolve
 * AND the LAST such node carries a stem, the track plays the stem:
 * clips are replaced by a single player over the rendered WAV (start
 * 0, NO implicit fade - the stem is a finished mix, its clip fades
 * are already baked; an extra edge ramp would betray the render), and
 * only the chain AFTER that node stays live.
 *
 * @param resolvable  can this machine instantiate the uid?
 * @return active=false when nothing needs (or can get) substitution;
 *         resume_index = first chain index that stays live.
 */
struct StemSubstitution {
    bool active = false;
    size_t resume_index = 0;
    ClipPlayer stem_player;
    std::string stem_hash;  // for logs/telemetry
};
StemSubstitution resolveStemSubstitution(
    const document::TrackDef& track_def,
    const std::function<bool(const std::string& uid)>& resolvable,
    const std::string& assets_dir,
    AssetCache& asset_cache);

}  // namespace daw::graph
