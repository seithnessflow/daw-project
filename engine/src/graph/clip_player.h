#pragma once

/**
 * @file clip_player.h
 * @brief WAV file player with sample-accurate positioning.
 *
 * Loads WAV files using dr_wav and plays them at specified timeline positions.
 * Handles mono/stereo conversion and sample-accurate start/offset.
 */

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace daw::graph {

/**
 * Audio asset loaded into memory.
 *
 * Stores deinterleaved audio data for efficient processing.
 * Mono files are stored as single channel, stereo as two channels.
 */
struct AudioAsset {
    std::vector<float> samples;  // Interleaved if stereo
    uint32_t channels = 0;
    uint32_t sample_rate = 0;
    uint64_t frame_count = 0;
    std::string hash;  // SHA-256 of original file

    [[nodiscard]] bool isValid() const noexcept {
        return channels > 0 && sample_rate > 0 && frame_count > 0;
    }

    [[nodiscard]] bool isMono() const noexcept {
        return channels == 1;
    }

    [[nodiscard]] bool isStereo() const noexcept {
        return channels == 2;
    }
};

/**
 * Clip definition.
 */
struct ClipInfo {
    std::string id;
    std::string asset_hash;
    int64_t start_sample = 0;    // Timeline position where clip starts
    int64_t length_samples = 0;  // Duration of clip
    int64_t offset_samples = 0;  // Offset into asset
};

/**
 * Clip player for a single track.
 *
 * Manages multiple clips on a track and renders them at the correct
 * timeline positions.
 */
class ClipPlayer {
public:
    ClipPlayer();
    ~ClipPlayer();

    // Non-copyable
    ClipPlayer(const ClipPlayer&) = delete;
    ClipPlayer& operator=(const ClipPlayer&) = delete;

    // Movable
    ClipPlayer(ClipPlayer&&) noexcept;
    ClipPlayer& operator=(ClipPlayer&&) noexcept;

    /**
     * Load a WAV file from disk.
     *
     * @param path Path to WAV file
     * @return Loaded asset, or invalid asset on failure
     */
    static AudioAsset loadWav(const std::string& path);

    /**
     * Set the asset to use for playback.
     *
     * @param asset Audio asset (must remain valid for lifetime of player)
     */
    void setAsset(const AudioAsset* asset);

    /**
     * Set clip information.
     *
     * @param clip Clip definition
     */
    void setClip(const ClipInfo& clip);

    /**
     * Render audio at the given timeline position.
     *
     * AUDIO THREAD - Sacred thread rules apply.
     *
     * @param output Output buffer (interleaved stereo)
     * @param frame_count Number of frames to render
     * @param position_samples Current timeline position
     */
    void render(
        float* output,
        uint32_t frame_count,
        int64_t position_samples
    ) noexcept;

    /**
     * Check if the clip is active at the given position.
     *
     * @param position_samples Timeline position
     * @param frame_count Number of frames in the block
     * @return true if clip overlaps with this block
     */
    [[nodiscard]] bool isActiveAt(
        int64_t position_samples,
        uint32_t frame_count
    ) const noexcept;

    /**
     * Reset playback state.
     */
    void reset() noexcept;

    /**
     * Get the clip info.
     */
    [[nodiscard]] const ClipInfo& getClipInfo() const noexcept {
        return clip_;
    }

private:
    const AudioAsset* asset_ = nullptr;
    ClipInfo clip_;

    /**
     * Render a single sample from the asset.
     *
     * @param asset_frame Frame index within asset
     * @param channel Channel (0 or 1)
     * @return Sample value, or 0 if out of bounds
     */
    [[nodiscard]] float getSample(
        int64_t asset_frame,
        uint32_t channel
    ) const noexcept;
};

/**
 * Asset cache for loaded audio files.
 *
 * Maps asset hashes to loaded AudioAssets.
 */
class AssetCache {
public:
    /**
     * Load or retrieve an asset.
     *
     * @param path Path to audio file
     * @return Pointer to cached asset, or nullptr on failure
     */
    const AudioAsset* loadOrGet(const std::string& path);

    /**
     * Get an asset by hash.
     *
     * @param hash Asset hash
     * @return Pointer to cached asset, or nullptr if not found
     */
    const AudioAsset* getByHash(const std::string& hash) const;

    /**
     * Clear all cached assets.
     */
    void clear();

    /**
     * Get number of cached assets.
     */
    [[nodiscard]] size_t size() const {
        return assets_.size();
    }

private:
    std::vector<std::unique_ptr<AudioAsset>> assets_;
    std::vector<std::string> paths_;  // Parallel to assets_ for path lookup
};

}  // namespace daw::graph
