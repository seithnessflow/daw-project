// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file offline_render.h
 * @brief Offline (non-realtime) rendering to WAV file.
 *
 * Renders the project document to a WAV file without real-time constraints.
 * Used for bouncing/exporting and for deterministic testing.
 */

#include "../document/automerge_document.h"
#include "../graph/audio_graph.h"
#include "../graph/clip_player.h"
#include "../host/plugin_bridge.h"
#include "../host/sync_proxy_node.h"

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace daw::render {

/**
 * Render configuration.
 */
struct RenderConfig {
    uint32_t sample_rate = 48000;
    uint32_t bit_depth = 24;      // 16, 24, or 32
    uint32_t block_size = 512;    // Processing block size
    int64_t start_sample = 0;     // Start position
    int64_t end_sample = -1;      // End position (-1 = end of project)
};

/**
 * Render progress callback.
 *
 * @param current_sample Current sample position
 * @param total_samples Total samples to render
 * @return false to cancel rendering
 */
using RenderProgressCallback = std::function<bool(int64_t, int64_t)>;

/**
 * Render result.
 */
struct RenderResult {
    bool success = false;
    std::string error;
    int64_t samples_rendered = 0;
    double peak_left = 0.0;
    double peak_right = 0.0;
    bool clipped = false;
};

/**
 * Offline renderer.
 *
 * Renders a project document to a WAV file.
 */
class OfflineRenderer {
public:
    OfflineRenderer();
    ~OfflineRenderer();

    /**
     * Render a document to a WAV file.
     *
     * @param document Project document
     * @param output_path Output WAV file path
     * @param asset_dir Directory containing audio assets
     * @param config Render configuration
     * @param progress Progress callback (optional)
     * @return Render result
     */
    RenderResult render(
        const document::AutomergeDocument& document,
        const std::string& output_path,
        const std::string& asset_dir,
        const RenderConfig& config = {},
        RenderProgressCallback progress = nullptr
    );

    /**
     * Calculate the length of a project in samples.
     *
     * @param document Project document
     * @return Length in samples
     */
    static int64_t calculateProjectLength(const document::AutomergeDocument& document);

    /**
     * c-2: uid -> module resolution for "vst3" chain nodes (the document
     * carries uids, never paths). host_exe = the plugin_host binary. The
     * renderer spawns its OWN children (sync path, one producer per ring)
     * and reaps them per render.
     */
    void setVst3Modules(std::map<std::string, std::string> modules,
                        std::string host_exe) {
        vst3_modules_ = std::move(modules);
        host_exe_ = std::move(host_exe);
    }

private:
    graph::AssetCache asset_cache_;
    std::map<std::string, std::string> vst3_modules_;
    std::string host_exe_;
    std::vector<std::unique_ptr<host::PluginBridge>> bridges_;
    std::vector<host::SyncProxyNode*> sync_nodes_;  // owned by the graph
    // S7: chain nodes legitimately ABSENT from the built graph because a
    // stem carries their truth (the R5 completeness guard subtracts them)
    size_t stem_substituted_nodes_ = 0;

    /**
     * Build audio graph from document.
     */
    std::unique_ptr<graph::AudioGraph> buildGraph(
        const document::AutomergeDocument& document,
        const std::string& asset_dir,
        uint32_t sample_rate
    );

    /**
     * Write WAV file header.
     */
    bool writeWavHeader(
        std::ofstream& file,
        uint32_t sample_rate,
        uint32_t bit_depth,
        uint32_t channels,
        uint32_t data_size
    );

    /**
     * Convert float samples to integer format.
     */
    void convertSamples(
        const float* input,
        uint8_t* output,
        uint32_t frame_count,
        uint32_t bit_depth,
        double& peak_left,
        double& peak_right,
        bool& clipped
    );
};

}  // namespace daw::render
