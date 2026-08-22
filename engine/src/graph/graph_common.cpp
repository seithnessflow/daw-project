// SPDX-License-Identifier: GPL-3.0-or-later
#include "graph_common.h"

namespace daw::graph {

ClipPlayer makeClipPlayer(const document::ClipDef& clip_def,
                          const std::string& assets_dir,
                          AssetCache& asset_cache) {
    ClipPlayer player;

    ClipInfo info;
    info.id = clip_def.id;
    info.asset_hash = clip_def.asset_hash;
    info.start_sample = clip_def.start_sample;
    info.length_samples = clip_def.length_samples;
    info.offset_samples = clip_def.offset_samples;
    player.setClip(info);

    const std::string asset_path = assets_dir + "/" + clip_def.asset_hash + ".wav";
    const AudioAsset* asset = asset_cache.loadOrGet(asset_path);
    if (asset) {
        player.setAsset(asset);
    }

    return player;
}

std::unique_ptr<GainNode> makeGainNode(const document::ProcessorDef& proc_def) {
    float gain = 1.0f;
    auto it = proc_def.params.find("gain");
    if (it != proc_def.params.end()) {
        gain = it->second;
    }
    return std::make_unique<GainNode>(proc_def.id, gain);
}

}  // namespace daw::graph
