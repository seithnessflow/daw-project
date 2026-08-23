// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file stem_render.h
 * @brief S7: render a chain node's STEM - the INVARIANT's writing half.
 *
 * The machine that HAS the plugin renders, offline, the node and
 * everything upstream of it (the track's clips + chain up to and
 * including the node, track gain forced to 1.0, master forced to
 * 1.0 - both stay LIVE on the reading side). The WAV lands in the
 * assets dir under its sha256; pushing it to the server store and
 * writing the document fields are the CALLER's moves (control loop).
 *
 * stem_key is the INPUT-CACHE key (ADR-019 amendment: plugin version
 * and samplerate in the key, never a bit-exactness assertion about a
 * third party's render). Freshness = key mismatch = UI state.
 */

#include "../document/schema.h"

#include <cstdint>
#include <map>
#include <string>

namespace daw::render {

struct StemRenderResult {
    bool success = false;
    std::string error;
    std::string stem_hash;          // sha256 of the WAV, now in assets_dir
    std::string stem_key;           // input-cache key
    int64_t latency_samples = 0;    // declared PDC (0: offline sync path)
};

/**
 * The module's version tag for the cache key: sha256 over the module
 * BINARY (bundle directories walked in sorted order) - two builds of
 * the same plugin are two versions, which is exactly the multi-machine
 * bug the key exists to catch. Cached per path for the process life.
 * Empty string when the path cannot be read (the key then still
 * changes vs a readable module - never a silent match).
 */
std::string moduleVersionTag(const std::string& module_path);

/**
 * Compute the stem's input-cache key WITHOUT rendering (the freshness
 * probe). Deterministic over: uid, MODULE VERSION TAG, state, params,
 * samplerate, and the upstream audio (clip geometry + asset hashes +
 * fades, prior chain).
 */
std::string computeStemKey(const document::TrackDef& track,
                           size_t node_index,
                           uint32_t sample_rate,
                           const std::string& module_version_tag);

/**
 * Render the stem for `node_id` on `track_id`. vst3_modules/host_exe:
 * the resolution this machine has (it MUST cover the node's uid).
 */
StemRenderResult renderTrackStem(const document::ProjectDef& project,
                                 const std::string& track_id,
                                 const std::string& node_id,
                                 const std::string& assets_dir,
                                 const std::map<std::string, std::string>& vst3_modules,
                                 const std::string& host_exe);

}  // namespace daw::render
