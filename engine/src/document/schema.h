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
#include <string>
#include <utility>
#include <vector>

namespace daw::document {

/**
 * Current schema version (le MAX supporte en lecture).
 *
 * v2 (migration TEMPO T1, 2026-08-27) : domaine MUSICAL additif (ticks,
 * PPQ 960) A COTE des samples. Champ *_tick present (sentinelle -1 =
 * absent) = objet musical. Un document v1 pur ne bouge JAMAIS ; la
 * creation reste v1 (bump lazy cote web via ensureV2).
 */
constexpr uint32_t SCHEMA_VERSION = 2;

/** v2 : breakpoint de la carte de tempo (piecewise-constant). */
struct TempoPointDef {
    int64_t tick = 0;
    int64_t milli_bpm = 120000;  // borne 20000..999000 (clampee au noyau)
};

/** v2 : signature rythmique positionnee (non automatable). */
struct TimeSignatureDef {
    int64_t tick = 0;
    int32_t num = 4;
    int32_t den = 4;
};

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
    // AUDIT-5 1.1: an ORDERED list of pairs, not a map - SCHEMA.md says the
    // params are iterable by index across every stage (the web already uses
    // a list), and the STEM KEY must serialize them in DOCUMENT order, not
    // lexicographic map order. setParam upserts while preserving order.
    std::vector<std::pair<std::string, float>> params;

    void setParam(const std::string& key, float value) {
        for (auto& p : params) {
            if (p.first == key) { p.second = value; return; }
        }
        params.emplace_back(key, value);
    }
    [[nodiscard]] float getParam(const std::string& key, float dflt = 0.0f) const {
        for (const auto& p : params) {
            if (p.first == key) return p.second;
        }
        return dflt;
    }
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
 * MIDI note (v8). Positions RELATIVES au debut du clip (comme les DAW :
 * la note vit dans le clip, le clip est place sur la timeline). Un clip
 * qui porte des notes est un clip MIDI ; l'instrument en tete de chaine
 * de la piste les joue.
 */
struct NoteDef {
    uint8_t pitch = 60;        // 0..127 (60 = do central)
    uint8_t velocity = 100;    // 0..127
    int64_t start_sample = 0;  // relatif au debut du clip
    int64_t length_samples = 0;
    // v2 : positions musicales relatives au clip (PPQ 960). Sentinelle
    // -1 = absent (note absolue). Le domaine du clip parent gouverne.
    int64_t start_tick = -1;
    int64_t length_tick = -1;
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
    // v8 MIDI : notes du clip (vide = clip audio classique).
    std::vector<NoteDef> notes;
    // T7 Session : si non vide, ce clip est un SLOT du clip-launcher (pas
    // la timeline) - le moteur l'IGNORE en construisant le graphe timeline.
    std::string scene_id;
    // v2 : sentinelle -1 = absent. start_tick >= 0 = clip MUSICAL
    // (position en ticks, resolue en samples par resolveMusicalTime en
    // T2 AVANT buildGraph - le graphe ne voit que des samples).
    // Un clip audio musical garde length_samples (contenu jamais etire).
    int64_t start_tick = -1;
    int64_t length_tick = -1;

    [[nodiscard]] bool isMusical() const { return start_tick >= 0; }
};

/**
 * Track definition.
 */
/**
 * A2 automation (AUTOMATION-DESIGN.md, ecrit par le web en A1) : une
 * enveloppe temps -> valeur attachee a un parametre. v NORMALISE 0..1
 * (mappe par le consommateur : gain 0..1 -> 0..2, pan 0..1 -> -1..+1),
 * t en samples timeline, points TRIES par t (invariant d'ecriture web).
 * A2 n'evalue que les cibles de PISTE/MASTER (processor_id vide, param
 * gain|pan) - les params de device attendent la tranche A4.
 */
struct AutomationPointDef {
    int64_t t = 0;
    float v = 0.0f;
};

struct AutomationLaneDef {
    std::string id;
    std::string processor_id;  // vide = parametre de piste (ou master a la racine)
    std::string param;         // "gain" | "pan" | cle native | id VST3 decimal
    bool enabled = true;
    std::vector<AutomationPointDef> points;
    // v2 : true = les t des points sont des TICKS (lane musicale,
    // resolue en T2). false = samples (legacy).
    bool time_base_ticks = false;
};

struct TrackDef {
    std::string id;
    std::string name;
    float gain = 1.0f;
    // F2 : panoramique -1 (gauche) .. 0 (centre) .. +1 (droite). Additif :
    // 0 (centre) quand absent du document (anciens projets). Puissance egale
    // applique en sortie de piste (audio_graph::processTrack).
    float pan = 0.0f;
    std::vector<ClipDef> clips;
    std::vector<ProcessorDef> chain;
    // A2 : lanes d'automation de la piste (additif - vide sur vieux docs).
    std::vector<AutomationLaneDef> automation;
};

/**
 * Project document.
 */
struct ProjectDef {
    // La CREATION reste v1 (seed vendore byte-identique) ; v2 n'arrive
    // que par un document qui le porte deja (bump lazy cote web).
    uint32_t schema_version = 1;
    uint32_t sample_rate = 48000;
    float master_gain = 1.0f;  // V1.2: root masterGain, additive (1.0 when absent)
    std::vector<TrackDef> tracks;
    // A2 : lanes d'automation du MASTER (racine, additif).
    std::vector<AutomationLaneDef> automation;
    // v2 : tempo du projet en milli-BPM entier (120000 = 120 BPM), LWW.
    // Sentinelle 0 = absent du document (les consommateurs resolvent a
    // 120000 via le noyau) - la presence est preservee au round-trip.
    int64_t tempo_milli_bpm = 0;
    // v2 : carte de tempo piecewise-constant, triee par tick (vide =
    // le registre seul) et signatures positionnees (vide = 4/4).
    std::vector<TempoPointDef> tempo_map;
    std::vector<TimeSignatureDef> time_signature;
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
