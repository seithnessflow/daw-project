// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file schema.h
 * @brief Project document schema types.
 *
 * These types mirror the schema defined in docs/SCHEMA.md.
 * They are used to build the audio graph from the document.
 */

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace daw::document {

/**
 * Current schema version.
 */
constexpr uint32_t SCHEMA_VERSION = 1;

/**
 * Processor definition.
 *
 * type "builtin.gain": params key "gain" (linear factor).
 * type "vst3" (c-2): uid = 32-hex VST3 class id; params keys are VST3
 * param ids as DECIMAL STRINGS (e.g. "0"), values normalized 0..1. The
 * document NEVER contains module paths - uid -> module resolution is a
 * host-side concern (--vst3-module).
 */
struct ProcessorDef {
    std::string id;
    std::string type;
    std::string uid;  // vst3 only; empty otherwise
    bool bypass = false;  // 2.4d: document state, driven from the tab
    std::map<std::string, float> params;
    // 2.5-etat (ADDITIF, SCHEMA-V2-DESIGN 2): opaque plugin state as a
    // content-addressed reference into the store - the blob itself
    // NEVER enters the CRDT. state_version is an LWW counter (two
    // hashes have no order; binary states cannot merge).
    std::string state_hash;      // sha256 hex of the state blob; empty = none
    int64_t state_version = 0;
    // S7 STEMS (ADDITIF, SCHEMA-V2-DESIGN 3): the rendered TRUTH of
    // this node and everything upstream of it (clips + chain up to and
    // including this node, PRE track gain). A peer that cannot resolve
    // the uid plays the stem instead - the INVARIANT. stem_key is the
    // input-cache key (freshness is UI state, never a playback block).
    std::string stem_hash;            // sha256 of the rendered WAV in the store
    std::string stem_key;             // sha256 of the render INPUTS
    int64_t stem_latency_samples = 0; // declared PDC at render time
};

/**
 * Clip definition.
 */
struct ClipDef {
    std::string id;
    std::string asset_hash;
    int64_t start_sample = 0;
    int64_t length_samples = 0;
    int64_t offset_samples = 0;
    // V1.6: explicit fades, ADDITIVE (absent = 0). 0 means "engine
    // default": an implicit 4 ms anti-click ramp (see graph_common).
    int64_t fade_in_samples = 0;
    int64_t fade_out_samples = 0;
};

/**
 * Track definition.
 */
struct TrackDef {
    std::string id;
    std::string name;
    float gain = 1.0f;
    std::vector<ClipDef> clips;
    std::vector<ProcessorDef> chain;
};

/**
 * Project document.
 */
struct ProjectDef {
    uint32_t schema_version = SCHEMA_VERSION;
    uint32_t sample_rate = 48000;
    float master_gain = 1.0f;  // V1.2: root masterGain, additive (1.0 when absent)
    std::vector<TrackDef> tracks;
};

/**
 * Migrate a document to the current schema version.
 *
 * @param doc Document to migrate (modified in place)
 * @return true on success, false if migration failed
 */
bool migrateDocument(ProjectDef& doc);

/**
 * Validate a document against the schema.
 *
 * @param doc Document to validate
 * @return Empty string if valid, error message otherwise
 */
std::string validateDocument(const ProjectDef& doc);

}  // namespace daw::document
