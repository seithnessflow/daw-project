#include "audio_graph.h"
#include "../audio/audio_callback.h"  // for INTERNAL_BLOCK_SIZE

#include <algorithm>
#include <cmath>
#include <cstring>

// Verify that atomic<float> is lock-free on this platform.
// If this fails, the audio thread would use a hidden mutex.
static_assert(std::atomic<float>::is_always_lock_free,
    "std::atomic<float> must be lock-free for audio thread safety");

namespace daw::graph {

AudioGraph::AudioGraph() = default;
AudioGraph::~AudioGraph() = default;
AudioGraph::AudioGraph(AudioGraph&&) noexcept = default;
AudioGraph& AudioGraph::operator=(AudioGraph&&) noexcept = default;

bool AudioGraph::process(
    float* output,
    uint32_t frame_count,
    int64_t position_samples
) noexcept {
    // Guard against unprepared buffers
    if (track_buffer_.empty() || mix_buffer_.empty()) {
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return false;
    }

    // Assert: frame_count must not exceed buffer capacity
    // The callback loops in sub-blocks, so this should never fire
    const uint32_t max_frames = static_cast<uint32_t>(track_buffer_.size() / 2);
    if (frame_count > max_frames) {
        // This is a bug - the callback should never pass more than INTERNAL_BLOCK_SIZE
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return false;
    }

    // Clear output buffer
    std::memset(output, 0, frame_count * 2 * sizeof(float));

    if (tracks_.empty()) {
        return true;
    }

    // Check if any track is soloed
    bool has_solo = false;
    for (const auto& track : tracks_) {
        if (track.solo) {
            has_solo = true;
            break;
        }
    }

    // Process each track and mix
    for (size_t i = 0; i < tracks_.size(); ++i) {
        auto& track = tracks_[i];

        // Skip muted tracks
        if (track.mute) {
            peak_left_[i] = 0.0f;
            peak_right_[i] = 0.0f;
            continue;
        }

        // If any track is soloed, skip non-soloed tracks
        if (has_solo && !track.solo) {
            peak_left_[i] = 0.0f;
            peak_right_[i] = 0.0f;
            continue;
        }

        // Process track into track buffer
        processTrack(track, track_buffer_.data(), frame_count, position_samples, i);

        // Mix into output
        for (uint32_t j = 0; j < frame_count * 2; ++j) {
            output[j] += track_buffer_[j];
        }
    }

    return true;
}

void AudioGraph::processTrack(
    AudioTrack& track,
    float* output,
    uint32_t frame_count,
    int64_t position_samples,
    size_t track_index
) noexcept {
    // Clear track buffer
    std::memset(output, 0, frame_count * 2 * sizeof(float));

    // Render all clips and mix
    for (auto& clip : track.clips) {
        if (clip.isActiveAt(position_samples, frame_count)) {
            // Render clip into mix buffer
            clip.render(mix_buffer_.data(), frame_count, position_samples);

            // Mix into track output
            for (uint32_t i = 0; i < frame_count * 2; ++i) {
                output[i] += mix_buffer_[i];
            }
        }
    }

    // Apply track gain (atomic load for thread-safe real-time updates)
    const float gain_value = track.gain.load(std::memory_order_relaxed);
    for (uint32_t i = 0; i < frame_count * 2; ++i) {
        output[i] *= gain_value;
    }

    // Process through chain
    for (auto& processor : track.chain) {
        processor->process(output, output, frame_count, position_samples);
    }

    // Calculate peaks for metering
    float peak_l = 0.0f;
    float peak_r = 0.0f;
    for (uint32_t i = 0; i < frame_count; ++i) {
        const float abs_l = std::fabs(output[i * 2]);
        const float abs_r = std::fabs(output[i * 2 + 1]);
        if (abs_l > peak_l) peak_l = abs_l;
        if (abs_r > peak_r) peak_r = abs_r;
    }
    peak_left_[track_index].store(peak_l, std::memory_order_relaxed);
    peak_right_[track_index].store(peak_r, std::memory_order_relaxed);
}

void AudioGraph::prepare(uint32_t sample_rate, uint32_t max_block_size) {
    sample_rate_ = sample_rate;
    max_block_size_ = max_block_size;

    // Allocate scratch buffers for fixed internal block size only
    // The callback loops in sub-blocks of audio::INTERNAL_BLOCK_SIZE (256 frames)
    // No safety margin needed - we control the block size
    track_buffer_.resize(audio::INTERNAL_BLOCK_SIZE * audio::kChannelCount);
    mix_buffer_.resize(audio::INTERNAL_BLOCK_SIZE * audio::kChannelCount);

    // Allocate atomic peak meters
    num_tracks_ = tracks_.size();
    peak_left_ = std::make_unique<std::atomic<float>[]>(num_tracks_);
    peak_right_ = std::make_unique<std::atomic<float>[]>(num_tracks_);

    // Initialize to zero
    for (size_t i = 0; i < num_tracks_; ++i) {
        peak_left_[i].store(0.0f, std::memory_order_relaxed);
        peak_right_[i].store(0.0f, std::memory_order_relaxed);
    }

    // Prepare all processors
    for (auto& track : tracks_) {
        for (auto& processor : track.chain) {
            processor->prepare(sample_rate, max_block_size);
        }
    }
}

void AudioGraph::reset() noexcept {
    for (auto& track : tracks_) {
        for (auto& clip : track.clips) {
            clip.reset();
        }
        for (auto& processor : track.chain) {
            processor->reset();
        }
    }

    // Clear peaks (atomic)
    for (size_t i = 0; i < num_tracks_; ++i) {
        peak_left_[i].store(0.0f, std::memory_order_relaxed);
        peak_right_[i].store(0.0f, std::memory_order_relaxed);
    }
}

void AudioGraph::addTrack(AudioTrack track) {
    // Note: peak arrays are allocated in prepare() after all tracks are added
    tracks_.push_back(std::move(track));
}

AudioTrack* AudioGraph::getTrackById(const std::string& id) noexcept {
    for (auto& track : tracks_) {
        if (track.id == id) {
            return &track;
        }
    }
    return nullptr;
}

std::vector<std::tuple<std::string, float, float>> AudioGraph::getMeters() const noexcept {
    std::vector<std::tuple<std::string, float, float>> meters;
    meters.reserve(tracks_.size());

    for (size_t i = 0; i < num_tracks_; ++i) {
        meters.emplace_back(
            tracks_[i].id,
            peak_left_[i].load(std::memory_order_relaxed),
            peak_right_[i].load(std::memory_order_relaxed)
        );
    }

    return meters;
}

// GraphBuilder implementation

std::unique_ptr<AudioGraph> GraphBuilder::build(
    const std::vector<AudioTrack>& tracks,
    uint32_t sample_rate
) {
    auto graph = std::make_unique<AudioGraph>();
    graph->setSampleRate(sample_rate);

    for (const auto& track : tracks) {
        AudioTrack new_track;
        new_track.id = track.id;
        new_track.name = track.name;
        new_track.gain.store(track.gain.load(std::memory_order_relaxed), std::memory_order_relaxed);

        // Copy clips (assets must be resolved separately)
        for (const auto& clip : track.clips) {
            ClipPlayer player;
            player.setClip(clip.getClipInfo());

            // Look up asset in cache
            if (asset_cache_) {
                const AudioAsset* asset = asset_cache_->getByHash(
                    clip.getClipInfo().asset_hash
                );
                if (asset) {
                    player.setAsset(asset);
                }
            }

            new_track.clips.push_back(std::move(player));
        }

        // Copy processors (need to recreate)
        for (const auto& processor : track.chain) {
            if (processor->getType() == GainNode::TYPE) {
                auto gain_node = std::make_unique<GainNode>(
                    processor->getId(),
                    processor->getParameter(GainNode::PARAM_GAIN)
                );
                new_track.chain.push_back(std::move(gain_node));
            }
            // Add other processor types here
        }

        graph->addTrack(std::move(new_track));
    }

    return graph;
}

}  // namespace daw::graph
