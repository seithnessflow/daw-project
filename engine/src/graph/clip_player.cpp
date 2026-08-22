// SPDX-License-Identifier: GPL-3.0-or-later
#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"

#include "clip_player.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <sstream>

// 2.3a: assetHash is finally what SCHEMA.md always claimed - SHA-256 of
// the file CONTENTS (self-contained impl in util/sha256, FIPS-vector
// tested). Content addressing semantics unchanged: the hash is the asset's
// name key (<hash>.wav) across the whole pipeline.
#include "../util/sha256.h"

namespace daw::graph {

// ClipPlayer implementation

ClipPlayer::ClipPlayer() = default;
ClipPlayer::~ClipPlayer() = default;
ClipPlayer::ClipPlayer(ClipPlayer&&) noexcept = default;
ClipPlayer& ClipPlayer::operator=(ClipPlayer&&) noexcept = default;

AudioAsset ClipPlayer::loadWav(const std::string& path) {
    AudioAsset asset;

    drwav wav;
    if (!drwav_init_file(&wav, path.c_str(), nullptr)) {
        return asset;  // Invalid asset
    }

    asset.channels = wav.channels;
    asset.sample_rate = wav.sampleRate;
    asset.frame_count = wav.totalPCMFrameCount;

    // Read all samples as float
    const size_t total_samples = asset.frame_count * asset.channels;
    asset.samples.resize(total_samples);

    const drwav_uint64 frames_read = drwav_read_pcm_frames_f32(
        &wav,
        asset.frame_count,
        asset.samples.data()
    );

    drwav_uninit(&wav);

    if (frames_read != asset.frame_count) {
        asset.samples.clear();
        asset.channels = 0;
        return asset;  // Invalid asset
    }

    // Compute hash
    asset.hash = daw::util::sha256HexFile(path);

    return asset;
}

void ClipPlayer::setAsset(const AudioAsset* asset) {
    asset_ = asset;
}

void ClipPlayer::setClip(const ClipInfo& clip) {
    clip_ = clip;
}

void ClipPlayer::render(
    float* output,
    uint32_t frame_count,
    int64_t position_samples
) noexcept {
    if (!asset_ || !asset_->isValid()) {
        // No asset - output silence
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return;
    }

    // Calculate clip boundaries
    const int64_t clip_start = clip_.start_sample;
    const int64_t clip_end = clip_.start_sample + clip_.length_samples;
    const int64_t block_end = position_samples + static_cast<int64_t>(frame_count);

    // Check if clip is active in this block
    if (position_samples >= clip_end || block_end <= clip_start) {
        // Clip not active - output silence
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return;
    }

    // Render each frame
    for (uint32_t i = 0; i < frame_count; ++i) {
        const int64_t timeline_pos = position_samples + static_cast<int64_t>(i);

        // Check if this frame is within the clip
        if (timeline_pos >= clip_start && timeline_pos < clip_end) {
            // Calculate position within asset
            const int64_t clip_offset = timeline_pos - clip_start;
            const int64_t asset_frame = clip_.offset_samples + clip_offset;

            // Get samples (handles mono-to-stereo conversion)
            output[i * 2]     = getSample(asset_frame, 0);
            output[i * 2 + 1] = getSample(asset_frame, 1);
        } else {
            // Outside clip - silence
            output[i * 2]     = 0.0f;
            output[i * 2 + 1] = 0.0f;
        }
    }
}

bool ClipPlayer::isActiveAt(
    int64_t position_samples,
    uint32_t frame_count
) const noexcept {
    const int64_t clip_start = clip_.start_sample;
    const int64_t clip_end = clip_.start_sample + clip_.length_samples;
    const int64_t block_end = position_samples + static_cast<int64_t>(frame_count);

    return position_samples < clip_end && block_end > clip_start;
}

void ClipPlayer::reset() noexcept {
    // Nothing to reset for now
}

float ClipPlayer::getSample(
    int64_t asset_frame,
    uint32_t channel
) const noexcept {
    if (!asset_ || asset_frame < 0 ||
        static_cast<uint64_t>(asset_frame) >= asset_->frame_count) {
        return 0.0f;
    }

    if (asset_->isMono()) {
        // Mono: same sample for both channels
        return asset_->samples[static_cast<size_t>(asset_frame)];
    } else if (asset_->isStereo()) {
        // Stereo: interleaved samples
        const size_t idx = static_cast<size_t>(asset_frame) * 2 + channel;
        return asset_->samples[idx];
    }

    return 0.0f;
}

// AssetCache implementation

const AudioAsset* AssetCache::loadOrGet(const std::string& path) {
    // Check if already loaded
    for (size_t i = 0; i < paths_.size(); ++i) {
        if (paths_[i] == path) {
            return assets_[i].get();
        }
    }

    // Load new asset
    auto asset = std::make_unique<AudioAsset>(ClipPlayer::loadWav(path));
    if (!asset->isValid()) {
        return nullptr;
    }

    const AudioAsset* ptr = asset.get();
    paths_.push_back(path);
    assets_.push_back(std::move(asset));

    return ptr;
}

const AudioAsset* AssetCache::getByHash(const std::string& hash) const {
    for (const auto& asset : assets_) {
        if (asset->hash == hash) {
            return asset.get();
        }
    }
    return nullptr;
}

void AssetCache::clear() {
    assets_.clear();
    paths_.clear();
}

}  // namespace daw::graph
