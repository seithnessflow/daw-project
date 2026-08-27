// SPDX-License-Identifier: GPL-3.0-or-later
#include "schema.h"

#include <sstream>

namespace daw::document {

bool migrateDocument(ProjectDef& doc) {
    // Version 1 is the initial version - no migration needed
    if (doc.schema_version == 0) {
        // Hypothetical v0 -> v1 migration
        // No v0 documents exist, so this branch is never taken.
        doc.schema_version = 1;
    }

    if (doc.schema_version > SCHEMA_VERSION) {
        // Future version - cannot migrate backwards
        return false;
    }

    // v2 est PUREMENT ADDITIF (champs musicaux optionnels, sentinelles
    // -1/0 = absent) : un lecteur v2 lit un v1 tel quel, rien a migrer
    // et on ne bump JAMAIS ici (lazy cote web via ensureV2 - un v1 pur
    // reste v1, le seed vendore reste byte-identique).

    return doc.schema_version >= 1 && doc.schema_version <= SCHEMA_VERSION;
}

std::string validateDocument(const ProjectDef& doc) {
    std::ostringstream errors;

    // Check schema version
    if (doc.schema_version == 0) {
        errors << "Schema version must be >= 1. ";
    }

    if (doc.schema_version > SCHEMA_VERSION) {
        errors << "Schema version " << doc.schema_version
               << " is not supported (max: " << SCHEMA_VERSION << "). ";
    }

    // Check sample rate
    if (doc.sample_rate == 0) {
        errors << "Sample rate must be > 0. ";
    }

    // Validate tracks
    for (size_t i = 0; i < doc.tracks.size(); ++i) {
        const auto& track = doc.tracks[i];

        if (track.id.empty()) {
            errors << "Track " << i << " has empty ID. ";
        }

        if (track.gain < 0.0f || track.gain > 2.0f) {
            errors << "Track " << track.id << " has invalid gain "
                   << track.gain << " (must be 0.0-2.0). ";
        }

        if (track.pan < -1.0f || track.pan > 1.0f) {  // F2
            errors << "Track " << track.id << " has invalid pan "
                   << track.pan << " (must be -1.0..1.0). ";
        }

        // Validate clips
        for (size_t j = 0; j < track.clips.size(); ++j) {
            const auto& clip = track.clips[j];

            if (clip.id.empty()) {
                errors << "Track " << track.id << " clip " << j
                       << " has empty ID. ";
            }

            if (clip.asset_hash.empty()) {
                errors << "Track " << track.id << " clip " << clip.id
                       << " has empty asset hash. ";
            }

            if (clip.start_sample < 0) {
                errors << "Track " << track.id << " clip " << clip.id
                       << " has negative start sample. ";
            }

            if (clip.length_samples <= 0) {
                errors << "Track " << track.id << " clip " << clip.id
                       << " has invalid length. ";
            }

            if (clip.offset_samples < 0) {
                errors << "Track " << track.id << " clip " << clip.id
                       << " has negative offset. ";
            }
        }

        // Validate processors
        for (size_t j = 0; j < track.chain.size(); ++j) {
            const auto& proc = track.chain[j];

            if (proc.id.empty()) {
                errors << "Track " << track.id << " processor " << j
                       << " has empty ID. ";
            }

            if (proc.type.empty()) {
                errors << "Track " << track.id << " processor " << proc.id
                       << " has empty type. ";
            }
        }
    }

    return errors.str();
}

}  // namespace daw::document
