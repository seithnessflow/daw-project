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
 */
struct ProcessorDef {
    std::string id;
    std::string type;
    std::map<std::string, float> params;
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
