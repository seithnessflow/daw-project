// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file audio_graph.h
 * @brief Audio processing graph.
 *
 * The audio graph is a projection of the project document. It is rebuilt
 * whenever the document changes, and swapped atomically with the active
 * graph on the audio thread.
 */

#include "processor_node.h"
#include "clip_player.h"
#include "gain_node.h"

#include <atomic>
#include <memory>
#include <string>
#include <tuple>
#include <vector>

namespace daw::graph {

/**
 * A track in the audio graph.
 *
 * Contains clips and a processing chain.
 */
struct AudioTrack {
    std::string id;
    std::string name;
    std::atomic<float> gain{1.0f};  // Track gain (atomic for real-time updates)

    std::vector<ClipPlayer> clips;
    std::vector<std::unique_ptr<ProcessorNode>> chain;

    // Per-track monitoring state (local, not in document). Atomic: written
    // by the WebSocket thread (handleSetMonitor), read by the audio thread
    // (S4 - same mold as gain/peaks, relaxed is sufficient).
    std::atomic<bool> solo{false};
    std::atomic<bool> mute{false};

    // Default constructor
    AudioTrack() = default;

    // Move constructor (atomics not movable, so we copy value)
    AudioTrack(AudioTrack&& other) noexcept
        : id(std::move(other.id))
        , name(std::move(other.name))
        , gain(other.gain.load(std::memory_order_relaxed))
        , clips(std::move(other.clips))
        , chain(std::move(other.chain))
        , solo(other.solo.load(std::memory_order_relaxed))
        , mute(other.mute.load(std::memory_order_relaxed)) {}

    // Move assignment
    AudioTrack& operator=(AudioTrack&& other) noexcept {
        if (this != &other) {
            id = std::move(other.id);
            name = std::move(other.name);
            gain.store(other.gain.load(std::memory_order_relaxed), std::memory_order_relaxed);
            clips = std::move(other.clips);
            chain = std::move(other.chain);
            solo.store(other.solo.load(std::memory_order_relaxed), std::memory_order_relaxed);
            mute.store(other.mute.load(std::memory_order_relaxed), std::memory_order_relaxed);
        }
        return *this;
    }

    // Non-copyable (unique_ptr in chain)
    AudioTrack(const AudioTrack&) = delete;
    AudioTrack& operator=(const AudioTrack&) = delete;
};

/**
 * Audio processing graph.
 *
 * Contains all tracks and manages mixing. This is immutable once created -
 * updates are done by building a new graph and swapping atomically.
 */
class AudioGraph {
public:
    AudioGraph();
    ~AudioGraph();

    // Non-copyable
    AudioGraph(const AudioGraph&) = delete;
    AudioGraph& operator=(const AudioGraph&) = delete;

    // Movable
    AudioGraph(AudioGraph&&) noexcept;
    AudioGraph& operator=(AudioGraph&&) noexcept;

    /**
     * Process audio for all tracks.
     *
     * AUDIO THREAD - Sacred thread rules apply.
     *
     * @param output Output buffer (interleaved stereo)
     * @param frame_count Number of frames to process
     * @param position_samples Current timeline position
     * @return true on success, false on underrun
     */
    bool process(
        float* output,
        uint32_t frame_count,
        int64_t position_samples
    ) noexcept;

    /**
     * Prepare all tracks for playback.
     *
     * Must be called before processing starts.
     *
     * @param sample_rate Sample rate in Hz
     * @param max_block_size Maximum block size
     */
    void prepare(uint32_t sample_rate, uint32_t max_block_size);

    /**
     * Reset all tracks.
     */
    void reset() noexcept;

    /**
     * Add a track to the graph.
     *
     * NOT thread-safe. Only call during graph construction.
     */
    void addTrack(AudioTrack track);

    /**
     * Get the number of tracks.
     */
    [[nodiscard]] size_t getTrackCount() const noexcept {
        return tracks_.size();
    }

    /**
     * Get a track by index.
     */
    [[nodiscard]] AudioTrack* getTrack(size_t index) noexcept {
        return index < tracks_.size() ? &tracks_[index] : nullptr;
    }

    /**
     * Get a track by ID.
     */
    [[nodiscard]] AudioTrack* getTrackById(const std::string& id) noexcept;

    /**
     * Set the sample rate.
     */
    void setSampleRate(uint32_t sample_rate) noexcept {
        sample_rate_ = sample_rate;
    }

    /**
     * Get the sample rate.
     */
    [[nodiscard]] uint32_t getSampleRate() const noexcept {
        return sample_rate_;
    }

    /**
     * Get peak meters for all tracks.
     *
     * @return Vector of (track_id, peak_left, peak_right)
     */
    [[nodiscard]] std::vector<std::tuple<std::string, float, float>> getMeters() const noexcept;

    /**
     * Zero all peak meters. AUDIO THREAD SAFE (relaxed atomic stores,
     * the processTrack mold). Called by the callback's silence path:
     * a stopped transport must not report ghost peaks forever
     * (found 2026-08-22 by the life layer's ballistics refusing to rest).
     */
    void clearMeters() noexcept {
        for (size_t i = 0; i < num_tracks_; ++i) {
            peak_left_[i].store(0.0f, std::memory_order_relaxed);
            peak_right_[i].store(0.0f, std::memory_order_relaxed);
        }
    }

    /**
     * Graph processing latency (2.4d): the worst track's chain latency sum.
     * Computed from the nodes' LIVE declarations - never a constant.
     * Control thread (telemetry); the graph is immutable once active.
     */
    [[nodiscard]] uint32_t getLatencySamples() const noexcept {
        uint32_t worst = 0;
        for (const auto& track : tracks_) {
            uint32_t sum = 0;
            for (const auto& processor : track.chain) {
                sum += processor->getLatencySamples();
            }
            if (sum > worst) worst = sum;
        }
        return worst;
    }

private:
    std::vector<AudioTrack> tracks_;
    uint32_t sample_rate_ = 48000;
    uint32_t max_block_size_ = 512;

    // Scratch buffers for mixing (pre-allocated)
    std::vector<float> track_buffer_;
    std::vector<float> mix_buffer_;

    // Per-track peak meters (thread-safe)
    // Written by audio thread in processTrack, read by main thread in getMeters.
    // Using std::atomic<float> with memory_order_relaxed for both operations.
    // Relaxed ordering is sufficient: no synchronization needed, we just want
    // a recent-ish value for visual metering. No barriers, no cost.
    size_t num_tracks_ = 0;
    std::unique_ptr<std::atomic<float>[]> peak_left_;
    std::unique_ptr<std::atomic<float>[]> peak_right_;

    /**
     * Process a single track.
     *
     * @param track Track to process
     * @param output Output buffer
     * @param frame_count Number of frames
     * @param position_samples Timeline position
     * @param track_index Track index for metering
     */
    void processTrack(
        AudioTrack& track,
        float* output,
        uint32_t frame_count,
        int64_t position_samples,
        size_t track_index
    ) noexcept;
};

/**
 * Graph builder - constructs AudioGraph from document data.
 */
class GraphBuilder {
public:
    /**
     * Set the asset cache for loading clips.
     */
    void setAssetCache(AssetCache* cache) {
        asset_cache_ = cache;
    }

    /**
     * Build a graph from track data.
     *
     * @param tracks Track data (id, name, gain, clips, chain)
     * @param sample_rate Sample rate
     * @return Built audio graph
     */
    std::unique_ptr<AudioGraph> build(
        const std::vector<AudioTrack>& tracks,
        uint32_t sample_rate
    );

private:
    AssetCache* asset_cache_ = nullptr;
};

}  // namespace daw::graph
