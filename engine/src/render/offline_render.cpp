// SPDX-License-Identifier: GPL-3.0-or-later
#include "offline_render.h"

#include "../audio/audio_callback.h"  // audio::INTERNAL_BLOCK_SIZE
#include "../document/resolve_time.h" // T2 : point d'etranglement musical
#include "../graph/graph_common.h"    // makeClipPlayer / makeGainNode (S3)

#include <algorithm>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <cstring>
#include <fstream>
#include <iostream>

namespace daw::render {

OfflineRenderer::OfflineRenderer() = default;
OfflineRenderer::~OfflineRenderer() = default;

RenderResult OfflineRenderer::render(
    const document::AutomergeDocument& document,
    const std::string& output_path,
    const std::string& asset_dir,
    const RenderConfig& config,
    RenderProgressCallback progress
) {
    RenderResult result;

    if (!document.isLoaded()) {
        result.error = "Document not loaded";
        return result;
    }

    // T2 : LE point d'etranglement temps musical -> samples. En aval,
    // le build et le rendu ne voient QUE des samples resolus ; un doc
    // v1 pur passe byte-identique (resolveMusicalTime = no-op).
    auto doc = document.getDocument();
    document::resolveMusicalTime(doc);

    // Fresh plugin children per render (one producer per ring)
    bridges_.clear();
    sync_nodes_.clear();

    // Build audio graph
    auto graph = buildGraph(doc, asset_dir, config.sample_rate);
    if (!graph) {
        result.error = "Failed to build audio graph";
        return result;
    }

    // AUDIT R5: an unknown node type or an unresolvable/unspawnable vst3
    // node must FAIL the render, never silently change the sound. S7:
    // nodes whose truth a STEM carries are accounted for, not missing.
    {
        size_t doc_nodes = 0;
        for (const auto& t : doc.tracks) doc_nodes += t.chain.size();
        doc_nodes -= (std::min)(stem_substituted_nodes_, doc_nodes);
        size_t built_nodes = 0;
        for (size_t i = 0; i < graph->getTrackCount(); ++i) {
            built_nodes += graph->getTrack(i)->chain.size();
        }
        if (built_nodes != doc_nodes) {
            result.error = "Chain incomplete: document has " +
                           std::to_string(doc_nodes) + " nodes, graph built " +
                           std::to_string(built_nodes) +
                           " (unknown type, missing --vst3-module mapping, or child failed)";
            return result;
        }
    }

    // The graph's scratch buffers are sized for INTERNAL_BLOCK_SIZE frames:
    // the render loop below must never feed process() more than that.
    graph->prepare(config.sample_rate, audio::INTERNAL_BLOCK_SIZE);

    // Preuve audio par etage (2026-08-27) : installee AVANT le pre-roll ?
    // NON - apres (voir plus bas) : le pre-roll rejoue un segment pour
    // chauffer l'etat des plugins, ses octets ne font pas partie du rendu
    // et pollueraient les hash d'etage.
    graph::StageProbe probe;

    // Calculate render range
    int64_t start = config.start_sample;
    int64_t end = config.end_sample;
    if (end < 0) {
        end = calculateProjectLength(document);
    }

    if (end <= start) {
        result.error = "Invalid render range";
        return result;
    }

    const int64_t total_samples = end - start;

    // Calculate output size
    const uint32_t bytes_per_sample = config.bit_depth / 8;
    const uint32_t channels = 2;
    const uint32_t data_size = static_cast<uint32_t>(total_samples) * channels * bytes_per_sample;

    // Open output file
    std::ofstream file(output_path, std::ios::binary);
    if (!file) {
        result.error = "Failed to open output file: " + output_path;
        return result;
    }

    // Write WAV header
    if (!writeWavHeader(file, config.sample_rate, config.bit_depth, channels, data_size)) {
        result.error = "Failed to write WAV header";
        return result;
    }

    // Allocate buffers
    std::vector<float> float_buffer(audio::INTERNAL_BLOCK_SIZE * channels);
    std::vector<uint8_t> int_buffer(audio::INTERNAL_BLOCK_SIZE * channels * bytes_per_sample);

    // Render loop. Fixed sub-blocks of INTERNAL_BLOCK_SIZE, exactly like the
    // audio callback: AudioGraph::process rejects larger blocks (its scratch
    // buffers hold INTERNAL_BLOCK_SIZE frames). Driving it with
    // config.block_size used to silently render silence for every full-size
    // block: process() returned false and the result was never checked.
    // DETERMINISME (2026-08-25) : PRE-ROLL. Un plugin a etat interne
    // (filtre, enveloppe, rampe de denormals) produit un transitoire de
    // demarrage qui depend de son etat d'ENTREE, pas seulement de l'audio
    // rendu -> stem non reproductible (mesure Python/numpy sur Rift : les
    // deux rendus different sur les 40 premieres ms puis sont identiques au
    // bit pres). On fait tourner le graphe sur la fenetre AVANT `start`
    // (silence pour un stem qui commence a 0 : positions hors de tout clip,
    // que la boucle principale sait deja rendre en silence), sortie JETEE,
    // pour amener chaque plugin a un etat canonique determine par l'entree.
    // On ne re-rend JAMAIS [start, start+preroll) (ca contaminerait les
    // effets a queue - reverb/delay). ~170 ms @48k, marge large sur le
    // transitoire observe ; sous-multiple d'INTERNAL_BLOCK_SIZE.
    constexpr int64_t kPreRollFrames = 8192;
    for (int64_t warm = start - kPreRollFrames; warm < start; ) {
        const uint32_t warm_frames = static_cast<uint32_t>(
            std::min(start - warm, static_cast<int64_t>(audio::INTERNAL_BLOCK_SIZE)));
        std::fill(float_buffer.begin(), float_buffer.end(), 0.0f);
        if (!graph->process(float_buffer.data(), warm_frames, warm)) {
            result.error = "Graph pre-roll failed at sample " + std::to_string(warm);
            return result;
        }
        warm += warm_frames;
    }

    // Preuve par etage : posee APRES le pre-roll (ses octets jetes ne font
    // pas partie du rendu et pollueraient les hash), retiree avant retour.
    if (!config.probe_path.empty()) {
        graph->setStageProbe(&probe);
    }

    int64_t position = start;
    while (position < end) {
        // Calculate block size for this iteration
        const int64_t remaining = end - position;
        const uint32_t block_frames = static_cast<uint32_t>(
            std::min(remaining, static_cast<int64_t>(audio::INTERNAL_BLOCK_SIZE))
        );

        // Clear buffer
        std::fill(float_buffer.begin(), float_buffer.end(), 0.0f);

        // Process. Offline, a failure is a bug, not an underrun: abort.
        if (!graph->process(float_buffer.data(), block_frames, position)) {
            result.error = "Graph processing failed at sample " + std::to_string(position);
            return result;
        }

        // Convert and accumulate peaks
        bool block_clipped = false;
        convertSamples(
            float_buffer.data(),
            int_buffer.data(),
            block_frames,
            config.bit_depth,
            result.peak_left,
            result.peak_right,
            block_clipped
        );

        if (block_clipped) {
            result.clipped = true;
        }

        // Write to file
        const size_t write_size = block_frames * channels * bytes_per_sample;
        file.write(reinterpret_cast<const char*>(int_buffer.data()), write_size);

        if (!file.good()) {
            result.error = "Write error";
            return result;
        }

        result.samples_rendered += block_frames;
        position += block_frames;

        // Progress callback
        if (progress) {
            if (!progress(position - start, total_samples)) {
                result.error = "Cancelled";
                return result;
            }
        }
    }

    // A bridge exchange that failed anywhere fails the WHOLE render -
    // silence was written in its place and must not ship as a bounce
    for (const auto* node : sync_nodes_) {
        if (node->failed()) {
            result.success = false;
            result.error = "Plugin bridge failed during render (node " +
                           node->getId() + ")";
            return result;
        }
    }

    // Preuve par etage : ecrire le JSON (echec = rendu QUAND MEME reussi,
    // mais on le dit - la preuve manquante ne doit pas passer inapercue)
    graph->setStageProbe(nullptr);
    if (!config.probe_path.empty()) {
        std::ofstream pf(config.probe_path, std::ios::binary);
        if (pf) {
            pf << probe.toJson();
            std::cout << "Stage probe written: " << config.probe_path << "\n";
        } else {
            std::cerr << "WARNING: stage probe NOT written (" << config.probe_path << ")\n";
        }
    }

    result.success = true;
    return result;
}

int64_t OfflineRenderer::calculateProjectLength(const document::AutomergeDocument& document) {
    int64_t max_end = 0;

    // T2 : la longueur se mesure sur les positions RESOLUES
    auto resolved = document.getDocument();
    document::resolveMusicalTime(resolved);
    for (const auto& track : resolved.tracks) {
        for (const auto& clip : track.clips) {
            const int64_t clip_end = clip.start_sample + clip.length_samples;
            if (clip_end > max_end) {
                max_end = clip_end;
            }
        }
    }

    return max_end;
}

std::unique_ptr<graph::AudioGraph> OfflineRenderer::buildGraph(
    const document::ProjectDef& doc,  // T2 : deja RESOLU par l'appelant
    const std::string& asset_dir,
    uint32_t sample_rate
) {
    auto graph_ptr = std::make_unique<graph::AudioGraph>();
    graph_ptr->setSampleRate(sample_rate);
    // v12 : le tempo du projet vers les plugins (ProcessContext) - meme
    // regle que le live : registre du document, 120 BPM pour un doc v1
    graph_ptr->setTempoMilliBpm(doc.tempo_milli_bpm > 0 ? doc.tempo_milli_bpm : 120000);
    stem_substituted_nodes_ = 0;  // per-build accounting (S7 / R5)
    native_latency_ = 0;          // session 4.3 : latence des natifs

    graph_ptr->setMasterGain(doc.master_gain);  // V1.2: same stage as live
    graph_ptr->setMasterAutomation(doc.automation);  // A2: same stage as live

    for (const auto& track_def : doc.tracks) {
        graph::AudioTrack track;
        track.id = track_def.id;
        track.name = track_def.name;
        track.gain = track_def.gain;
        track.pan = track_def.pan;  // F2 (pan==0 -> processTrack ne touche rien : hash inchange)
        track.automation = track_def.automation;  // A2 (aucune lane -> hash inchange)

        // S7: THE INVARIANT's reading half - an unresolvable plugin
        // with a stem plays its rendered truth (decision shared with
        // the live builder in graph_common).
        auto sub = graph::resolveStemSubstitution(
            track_def,
            [&](const std::string& uid) { return vst3_modules_.count(uid) > 0; },
            asset_dir, asset_cache_);
        if (sub.active) {
            std::cout << "Track " << track_def.id << ": playing STEM "
                      << sub.stem_hash.substr(0, 8)
                      << "... for an unresolved plugin\n";
            track.clips.push_back(std::move(sub.stem_player));
            stem_substituted_nodes_ += sub.resume_index;  // R5 accounting
        } else {
            // Load clips (shared geometry+asset builder, S3)
            for (const auto& clip_def : track_def.clips) {
                if (!clip_def.scene_id.empty()) continue;  // T7 : slot Session, pas timeline
                track.clips.push_back(
                    graph::makeClipPlayer(clip_def, asset_dir, asset_cache_,
                                          sample_rate));
            }
        }

        // v8 MIDI : notes ABSOLUES de la piste (tous clips), donnees au
        // PREMIER node vst3 de la chaine (l'instrument). Un clip audio
        // classique n'a pas de notes -> track_notes vide -> rien de change.
        std::vector<host::ScheduledNote> track_notes;
        for (const auto& clip_def : track_def.clips) {
            if (!clip_def.scene_id.empty()) continue;  // T7 : slot Session ignore
            for (const auto& n : clip_def.notes) {
                const int64_t abs_start = clip_def.start_sample + n.start_sample;
                track_notes.push_back(
                    {n.pitch, n.velocity, abs_start, abs_start + n.length_samples});
            }
        }
        bool notes_assigned = false;

        // Create processors (after the governing node when substituted)
        for (size_t proc_i = sub.active ? sub.resume_index : 0;
             proc_i < track_def.chain.size(); ++proc_i) {
            const auto& proc_def = track_def.chain[proc_i];
            if (proc_def.type.rfind("builtin.", 0) == 0) {
                if (proc_def.bypass) {
                    // zero-latency node: bypass = omission; the chain-count
                    // check still needs a node, so a bypassed SyncProxyNode
                    // (identity, no bridge) stands in
                    track.chain.push_back(std::make_unique<host::SyncProxyNode>(
                        proc_def.id, nullptr, true));
                    continue;
                }
                // Fabrique native PARTAGEE (session 4.1) - un dispatch
                auto node = graph::makeBuiltinNode(proc_def);
                if (node) {
                    native_latency_ += node->getLatencySamples();  // 4.3
                    track.chain.push_back(std::move(node));
                } else {
                    std::cerr << "Render: unknown builtin type '"
                              << proc_def.type << "' (node " << proc_def.id
                              << ") - render will fail\n";
                }
            } else if (proc_def.type == "vst3") {
                // c-2: out-of-process plugin, SYNC path (offline has no
                // real-time constraint; zero latency, bit-exact). A missing
                // mapping or failed spawn is a MISSING node - the render
                // loop declares the whole render failed via failed().
                if (proc_def.bypass) {
                    // 2.4d: bypassed = identity, no child spawned at all
                    track.chain.push_back(std::make_unique<host::SyncProxyNode>(
                        proc_def.id, nullptr, true));
                    continue;
                }
                auto module_it = vst3_modules_.find(proc_def.uid);
                if (module_it == vst3_modules_.end()) {
                    std::cerr << "Render: no --vst3-module mapping for uid "
                              << proc_def.uid << " (node " << proc_def.id
                              << ") - render will fail\n";
                    continue;  // caught by chain-count check in render()
                }
                auto bridge = std::make_unique<host::PluginBridge>();
                // 2.5-etat: the offline render honors captured state too
                // (blob by hash from the assets dir, ceremony-restored)
                if (!proc_def.state_hash.empty()) {
                    const auto blob_path = std::filesystem::path(asset_dir) /
                                           (proc_def.state_hash + ".wav");
                    std::ifstream bf(blob_path, std::ios::binary);
                    if (bf) {
                        std::vector<uint8_t> blob(
                            (std::istreambuf_iterator<char>(bf)),
                            std::istreambuf_iterator<char>());
                        if (!blob.empty()) bridge->setPendingState(std::move(blob));
                    }
                }
                if (!bridge->start(host_exe_, module_it->second, proc_def.uid,
                                   sample_rate)) {
                    std::cerr << "Render: plugin child failed for node "
                              << proc_def.id << ": " << bridge->error() << "\n";
                    continue;
                }
                for (const auto& [key, value] : proc_def.params) {
                    try {
                        bridge->setParam(static_cast<uint32_t>(std::stoul(key)), value);
                    } catch (const std::exception&) {
                        std::cerr << "Render: bad vst3 param key '" << key
                                  << "' on node " << proc_def.id << " (ignored)\n";
                    }
                }
                auto node = std::make_unique<host::SyncProxyNode>(proc_def.id, bridge.get());
                // v8 : le premier vst3 de la piste joue les notes (instrument).
                if (!notes_assigned && !track_notes.empty()) {
                    node->setNotes(track_notes);
                    notes_assigned = true;
                }
                sync_nodes_.push_back(node.get());
                bridges_.push_back(std::move(bridge));
                track.chain.push_back(std::move(node));
            } else {
                std::cerr << "Render: unknown chain node type '" << proc_def.type
                          << "' (node " << proc_def.id << ") - render will fail\n";
            }
        }

        graph_ptr->addTrack(std::move(track));
    }

    return graph_ptr;
}

bool OfflineRenderer::writeWavHeader(
    std::ofstream& file,
    uint32_t sample_rate,
    uint32_t bit_depth,
    uint32_t channels,
    uint32_t data_size
) {
    const uint32_t bytes_per_sample = bit_depth / 8;
    const uint32_t byte_rate = sample_rate * channels * bytes_per_sample;
    const uint16_t block_align = static_cast<uint16_t>(channels * bytes_per_sample);
    const uint32_t file_size = 36 + data_size;

    // RIFF header
    file.write("RIFF", 4);
    file.write(reinterpret_cast<const char*>(&file_size), 4);
    file.write("WAVE", 4);

    // fmt chunk
    file.write("fmt ", 4);
    uint32_t fmt_size = 16;
    file.write(reinterpret_cast<const char*>(&fmt_size), 4);

    // S7: 32-bit output is IEEE FLOAT (format 3), the DAW standard -
    // lossless for this float pipeline (stems depend on it), and it
    // retires the A4-12 INT_MIN class for this depth. 16/24 stay PCM.
    uint16_t audio_format = (bit_depth == 32) ? 3 : 1;
    file.write(reinterpret_cast<const char*>(&audio_format), 2);

    uint16_t num_channels = static_cast<uint16_t>(channels);
    file.write(reinterpret_cast<const char*>(&num_channels), 2);

    file.write(reinterpret_cast<const char*>(&sample_rate), 4);
    file.write(reinterpret_cast<const char*>(&byte_rate), 4);
    file.write(reinterpret_cast<const char*>(&block_align), 2);

    uint16_t bits = static_cast<uint16_t>(bit_depth);
    file.write(reinterpret_cast<const char*>(&bits), 2);

    // data chunk
    file.write("data", 4);
    file.write(reinterpret_cast<const char*>(&data_size), 4);

    return file.good();
}

void OfflineRenderer::convertSamples(
    const float* input,
    uint8_t* output,
    uint32_t frame_count,
    uint32_t bit_depth,
    double& peak_left,
    double& peak_right,
    bool& clipped
) {
    const uint32_t channels = 2;

    for (uint32_t i = 0; i < frame_count; ++i) {
        for (uint32_t ch = 0; ch < channels; ++ch) {
            float sample = input[i * channels + ch];

            // Track peaks
            const double abs_sample = std::fabs(sample);
            if (ch == 0 && abs_sample > peak_left) {
                peak_left = abs_sample;
            } else if (ch == 1 && abs_sample > peak_right) {
                peak_right = abs_sample;
            }

            // Clip detection. Float32 output (S7 stems) stays UNCLAMPED:
            // IEEE float WAV legally exceeds 1.0 and the stem must be the
            // EXACT chain output - the flag still reports.
            if (sample > 1.0f || sample < -1.0f) {
                clipped = true;
                if (bit_depth != 32) sample = std::clamp(sample, -1.0f, 1.0f);
            }

            // Convert to output format
            if (bit_depth == 16) {
                int16_t int_sample = static_cast<int16_t>(sample * 32767.0f);
                output[(i * channels + ch) * 2]     = static_cast<uint8_t>(int_sample & 0xFF);
                output[(i * channels + ch) * 2 + 1] = static_cast<uint8_t>((int_sample >> 8) & 0xFF);
            } else if (bit_depth == 24) {
                int32_t int_sample = static_cast<int32_t>(sample * 8388607.0f);
                output[(i * channels + ch) * 3]     = static_cast<uint8_t>(int_sample & 0xFF);
                output[(i * channels + ch) * 3 + 1] = static_cast<uint8_t>((int_sample >> 8) & 0xFF);
                output[(i * channels + ch) * 3 + 2] = static_cast<uint8_t>((int_sample >> 16) & 0xFF);
            } else if (bit_depth == 32) {
                // IEEE float, byte-exact passthrough
                uint32_t bits;
                std::memcpy(&bits, &sample, 4);
                output[(i * channels + ch) * 4]     = static_cast<uint8_t>(bits & 0xFF);
                output[(i * channels + ch) * 4 + 1] = static_cast<uint8_t>((bits >> 8) & 0xFF);
                output[(i * channels + ch) * 4 + 2] = static_cast<uint8_t>((bits >> 16) & 0xFF);
                output[(i * channels + ch) * 4 + 3] = static_cast<uint8_t>((bits >> 24) & 0xFF);
            }
        }
    }
}

}  // namespace daw::render
