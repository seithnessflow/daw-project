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

StemSubstitution resolveStemSubstitution(
    const document::TrackDef& track_def,
    const std::function<bool(const std::string& uid)>& resolvable,
    const std::string& assets_dir,
    AssetCache& asset_cache) {
    StemSubstitution out;

    // The LAST unresolvable vst3 node governs (design S7): its stem
    // covers everything upstream of it.
    size_t governing = SIZE_MAX;
    for (size_t i = 0; i < track_def.chain.size(); ++i) {
        const auto& p = track_def.chain[i];
        // bypassed = identity: an unresolvable BYPASSED node needs no
        // stem (the builders already play it dry)
        if (p.type == "vst3" && !p.bypass && !resolvable(p.uid)) {
            governing = i;
        }
    }
    if (governing == SIZE_MAX) return out;  // everything resolvable

    const auto& node = track_def.chain[governing];
    if (node.stem_hash.empty()) return out;  // no stem: current behavior
                                             // (node skipped, signaled)

    const std::string stem_path = assets_dir + "/" + node.stem_hash + ".wav";
    const AudioAsset* asset = asset_cache.loadOrGet(stem_path);
    if (!asset || !asset->isValid()) return out;  // blob unavailable

    ClipInfo info;
    info.id = "stem:" + node.id;
    info.asset_hash = node.stem_hash;
    info.start_sample = 0;
    // PDC, declared (SCHEMA-V2-DESIGN 3): the stem contains the
    // plugin's DELAYED output; playing it ADVANCED by the declared
    // latency realigns it with what the producing host heard. 0 for
    // the offline sync path (AGain) - the S7 byte-proof is untouched.
    const int64_t latency = (std::min)(
        node.stem_latency_samples < 0 ? 0 : node.stem_latency_samples,
        static_cast<int64_t>(asset->frame_count));
    info.offset_samples = latency;
    info.length_samples = static_cast<int64_t>(asset->frame_count) - latency;
    // fades stay 0: render() only ramps when > 0 - the finished mix
    // plays untouched (the implicit anti-click lives in makeClipPlayer,
    // deliberately NOT here)
    out.stem_player.setClip(info);
    out.stem_player.setAsset(asset);
    out.active = true;
    out.resume_index = governing + 1;
    out.stem_hash = node.stem_hash;
    return out;
}

std::unique_ptr<ProcessorNode> makeBuiltinNode(const document::ProcessorDef& proc_def) {
    if (proc_def.type == GainNode::TYPE) {
        return makeGainNode(proc_def);
    }
    auto get = [&](const char* k, float dv) {
        auto it = proc_def.params.find(k);
        return it != proc_def.params.end() ? it->second : dv;
    };
    if (proc_def.type == UtilityNode::TYPE) {
        return std::make_unique<UtilityNode>(
            proc_def.id, get(UtilityNode::PARAM_GAIN, 1.0f),
            get(UtilityNode::PARAM_PAN, 0.0f),
            get(UtilityNode::PARAM_MONO, 0.0f) >= 0.5f,
            get(UtilityNode::PARAM_PHASE, 0.0f) >= 0.5f);
    }
    if (proc_def.type == Eq3Node::TYPE) {
        return std::make_unique<Eq3Node>(
            proc_def.id, get("lowGainDb", 0.0f), get("lowFreq", 120.0f),
            get("peakGainDb", 0.0f), get("peakFreq", 1000.0f),
            get("peakQ", 0.9f), get("highGainDb", 0.0f),
            get("highFreq", 6000.0f));
    }
    if (proc_def.type == CompressorNode::TYPE) {
        return std::make_unique<CompressorNode>(
            proc_def.id, get("thresholdDb", -24.0f), get("ratio", 4.0f),
            get("attackMs", 10.0f), get("releaseMs", 100.0f),
            get("makeupDb", 0.0f));
    }
    return nullptr;
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
