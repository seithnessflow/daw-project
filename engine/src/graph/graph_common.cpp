// SPDX-License-Identifier: GPL-3.0-or-later
#include "graph_common.h"

namespace daw::graph {

ClipPlayer makeClipPlayer(const document::ClipDef& clip_def,
                          const std::string& assets_dir,
                          AssetCache& asset_cache,
                          uint32_t sample_rate) {
    ClipPlayer player;

    ClipInfo info;
    info.id = clip_def.id;
    info.asset_hash = clip_def.asset_hash;
    info.start_sample = clip_def.start_sample;
    info.length_samples = clip_def.length_samples;
    info.offset_samples = clip_def.offset_samples;

    // V1.6: effective fades - explicit, or implicit 4 ms anti-click
    // (sample_rate/250, integer, deterministic); clamp each to half the
    // clip so in+out never cross.
    const int64_t implicit_fade = static_cast<int64_t>(sample_rate / 250u);
    const int64_t half = clip_def.length_samples / 2;
    int64_t fade_in = clip_def.fade_in_samples > 0
        ? clip_def.fade_in_samples : implicit_fade;
    int64_t fade_out = clip_def.fade_out_samples > 0
        ? clip_def.fade_out_samples : implicit_fade;
    info.fade_in_samples = fade_in < half ? fade_in : half;
    info.fade_out_samples = fade_out < half ? fade_out : half;
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
