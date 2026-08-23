// SPDX-License-Identifier: GPL-3.0-or-later
#include "stem_render.h"

#include "offline_render.h"
#include "../document/automerge_document.h"
#include "../util/sha256.h"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <vector>

namespace fs = std::filesystem;

namespace daw::render {

std::string computeStemKey(const document::TrackDef& track,
                           size_t node_index,
                           uint32_t sample_rate) {
    // Canonical, order-stable text over every INPUT of the render.
    // A changed key = a stale stem (UI state, never a playback block).
    std::ostringstream k;
    k << "stem-v1|sr=" << sample_rate;
    const auto& node = track.chain[node_index];
    k << "|uid=" << node.uid << "|ver=";  // plugin version: dated debt
    k << "|state=" << node.state_hash << ":" << node.state_version;
    for (const auto& c : track.clips) {
        k << "|clip=" << c.asset_hash << "," << c.start_sample << ","
          << c.length_samples << "," << c.offset_samples << ","
          << c.fade_in_samples << "," << c.fade_out_samples;
    }
    for (size_t i = 0; i <= node_index; ++i) {
        const auto& p = track.chain[i];
        k << "|node=" << p.type << "," << p.uid << "," << (p.bypass ? 1 : 0);
        for (const auto& [key, value] : p.params) {
            k << "," << key << "=" << value;
        }
        if (i < node_index) {
            k << ",state=" << p.state_hash << ":" << p.state_version;
        }
    }
    const std::string s = k.str();
    return daw::util::sha256Hex(s.data(), s.size());
}

StemRenderResult renderTrackStem(const document::ProjectDef& project,
                                 const std::string& track_id,
                                 const std::string& node_id,
                                 const std::string& assets_dir,
                                 const std::map<std::string, std::string>& vst3_modules,
                                 const std::string& host_exe) {
    StemRenderResult out;

    const document::TrackDef* track = nullptr;
    for (const auto& t : project.tracks) {
        if (t.id == track_id) { track = &t; break; }
    }
    if (!track) {
        out.error = "track not found: " + track_id;
        return out;
    }
    size_t node_index = SIZE_MAX;
    for (size_t i = 0; i < track->chain.size(); ++i) {
        if (track->chain[i].id == node_id) { node_index = i; break; }
    }
    if (node_index == SIZE_MAX) {
        out.error = "node not found: " + node_id;
        return out;
    }

    // The REDUCED document: this track's clips + chain UP TO AND
    // INCLUDING the node; track gain and master forced to 1.0 (both
    // stay LIVE on the reading side - the stem is pre-gain truth).
    document::TrackDef reduced = *track;
    reduced.gain = 1.0f;
    reduced.chain.assign(track->chain.begin(),
                         track->chain.begin() +
                             static_cast<long long>(node_index) + 1);

    document::AutomergeDocument doc;
    if (!doc.create(project.sample_rate)) {
        out.error = "reduced doc create failed";
        return out;
    }
    if (!doc.addTrack(reduced)) {
        out.error = "reduced doc addTrack failed: " + doc.getLastError();
        return out;
    }
    // master_gain defaults to 1.0 in a fresh document - exactly wanted

    OfflineRenderer renderer;
    renderer.setVst3Modules(vst3_modules, host_exe);
    RenderConfig config;
    config.sample_rate = project.sample_rate;
    config.bit_depth = 32;  // IEEE float: the stem is LOSSLESS truth

    const fs::path tmp_wav =
        fs::path(assets_dir) / ("stem-" + node_id + ".tmp.wav");
    std::error_code ec;
    fs::create_directories(assets_dir, ec);
    const auto result = renderer.render(doc, tmp_wav.string(), assets_dir, config);
    if (!result.success) {
        out.error = "stem render failed: " + result.error;
        fs::remove(tmp_wav, ec);
        return out;
    }

    std::vector<char> bytes;
    {
        std::ifstream f(tmp_wav, std::ios::binary);
        bytes.assign(std::istreambuf_iterator<char>(f),
                     std::istreambuf_iterator<char>());
    }
    if (bytes.empty()) {
        out.error = "stem wav unreadable";
        fs::remove(tmp_wav, ec);
        return out;
    }
    out.stem_hash = daw::util::sha256Hex(bytes.data(), bytes.size());

    // Into the content-addressed assets (atomic rename of the temp)
    const fs::path final_path = fs::path(assets_dir) / (out.stem_hash + ".wav");
    fs::rename(tmp_wav, final_path, ec);
    if (ec) {
        fs::remove(tmp_wav, ec);
        out.error = "stem move failed";
        return out;
    }

    out.stem_key = computeStemKey(*track, node_index, project.sample_rate);
    out.latency_samples = 0;  // offline sync path: no pipeline depth
    out.success = true;
    return out;
}

}  // namespace daw::render
