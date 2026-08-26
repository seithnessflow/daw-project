// SPDX-License-Identifier: GPL-3.0-or-later
#include "graph_common.h"

#include "../util/path_safety.h"

#include <iostream>

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

    // Un hash VIDE est LEGITIME : clip MIDI (v8) / slot Session - ses notes
    // vont a l'instrument, il n'a pas d'asset. Sans ce cas, la garde B5
    // hurlait "unsafe hash" sur chaque clip MIDI (7 warnings par build de
    // graphe sur studio, 2026-08-27) : du bruit qui masquait les vrais.
    if (clip_def.asset_hash.empty()) {
        return player;  // clip sans audio, silencieux par nature
    }
    // AUDIT-5 B5: a document-supplied hash must never become a path escape.
    if (!daw::util::isPathComponentSafe(clip_def.asset_hash)) {
        std::cerr << "WARNING: unsafe asset hash rejected (path traversal?): "
                  << clip_def.asset_hash << " - clip silenced. AUDIT-5 B5.\n";
        return player;  // no asset -> silent clip, never an arbitrary open
    }
    const std::string asset_path = assets_dir + "/" + clip_def.asset_hash + ".wav";
    const AudioAsset* asset = asset_cache.loadOrGet(asset_path);
    if (asset) {
        player.setAsset(asset);
        // AUDIT-5 A7/B2: there is no sample-rate conversion. A clip whose asset
        // rate differs from the graph rate plays at the WRONG PITCH and drifts,
        // silently. Say it loud (the real fix - resample on import, or refuse -
        // is a dedicated session; the debt is in TODO/AUDIT-5).
        if (asset->sample_rate != 0 && asset->sample_rate != sample_rate) {
            std::cerr << "WARNING: asset " << clip_def.asset_hash.substr(0, 8)
                      << " is " << asset->sample_rate << " Hz but the graph runs at "
                      << sample_rate << " Hz - it plays at the WRONG PITCH and drifts "
                         "(no resampling yet). AUDIT-5 A7/B2.\n";
        }
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
    // AUDIT-5 B5: a document-supplied stem hash must never escape assets_dir.
    if (!daw::util::isPathComponentSafe(node.stem_hash)) {
        std::cerr << "WARNING: unsafe stem hash rejected (path traversal?): "
                  << node.stem_hash << " - no substitution. AUDIT-5 B5.\n";
        return out;
    }

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
    auto get = [&](const char* k, float dv) { return proc_def.getParam(k, dv); };
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
    if (proc_def.type == DriveNode::TYPE) {
        return std::make_unique<DriveNode>(
            proc_def.id, get("driveDb", 12.0f), get("levelDb", -6.0f),
            get("mix", 1.0f));
    }
    if (proc_def.type == DelayNode::TYPE) {
        return std::make_unique<DelayNode>(
            proc_def.id, get("timeMs", 350.0f), get("feedback", 0.35f),
            get("mix", 0.35f));
    }
    return nullptr;
}

std::unique_ptr<GainNode> makeGainNode(const document::ProcessorDef& proc_def) {
    const float gain = proc_def.getParam("gain", 1.0f);
    return std::make_unique<GainNode>(proc_def.id, gain);
}

}  // namespace daw::graph
