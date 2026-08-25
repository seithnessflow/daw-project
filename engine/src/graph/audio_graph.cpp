// SPDX-License-Identifier: GPL-3.0-or-later
#include "audio_graph.h"
#include "compressor_node.h"          // session 4.2: clone path
#include "delay_node.h"               // session 4.3: clone path
#include "drive_node.h"               // session 4.3: clone path
#include "eq3_node.h"                 // session 4.2: clone path
#include "utility_node.h"             // session 4.1: clone path
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

// Manual moves: the V1.2 master atomics delete the defaulted ones
// (AudioTrack's mold - atomics are copied by value, relaxed).
AudioGraph::AudioGraph(AudioGraph&& other) noexcept
    : tracks_(std::move(other.tracks_))
    , sample_rate_(other.sample_rate_)
    , max_block_size_(other.max_block_size_)
    , track_buffer_(std::move(other.track_buffer_))
    , mix_buffer_(std::move(other.mix_buffer_))
    , master_gain_(other.master_gain_.load(std::memory_order_relaxed))
    , master_peak_left_(other.master_peak_left_.load(std::memory_order_relaxed))
    , master_peak_right_(other.master_peak_right_.load(std::memory_order_relaxed))
    , num_tracks_(other.num_tracks_)
    , peak_left_(std::move(other.peak_left_))
    , peak_right_(std::move(other.peak_right_)) {}

AudioGraph& AudioGraph::operator=(AudioGraph&& other) noexcept {
    if (this != &other) {
        tracks_ = std::move(other.tracks_);
        sample_rate_ = other.sample_rate_;
        max_block_size_ = other.max_block_size_;
        track_buffer_ = std::move(other.track_buffer_);
        mix_buffer_ = std::move(other.mix_buffer_);
        master_gain_.store(other.master_gain_.load(std::memory_order_relaxed),
                           std::memory_order_relaxed);
        master_peak_left_.store(other.master_peak_left_.load(std::memory_order_relaxed),
                                std::memory_order_relaxed);
        master_peak_right_.store(other.master_peak_right_.load(std::memory_order_relaxed),
                                 std::memory_order_relaxed);
        num_tracks_ = other.num_tracks_;
        peak_left_ = std::move(other.peak_left_);
        peak_right_ = std::move(other.peak_right_);
    }
    return *this;
}

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
        // Master meters must SAY silence too (same lesson as clearMeters)
        master_peak_left_.store(0.0f, std::memory_order_relaxed);
        master_peak_right_.store(0.0f, std::memory_order_relaxed);
        return true;
    }

    // Check if any track is soloed
    bool has_solo = false;
    for (const auto& track : tracks_) {
        if (track.solo.load(std::memory_order_relaxed)) {
            has_solo = true;
            break;
        }
    }

    // Process each track and mix
    for (size_t i = 0; i < tracks_.size(); ++i) {
        auto& track = tracks_[i];

        // Skip muted tracks
        if (track.mute.load(std::memory_order_relaxed)) {
            peak_left_[i] = 0.0f;
            peak_right_[i] = 0.0f;
            continue;
        }

        // If any track is soloed, skip non-soloed tracks
        if (has_solo && !track.solo.load(std::memory_order_relaxed)) {
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

    // V1.2: master gain applied HERE - offline_render calls this same
    // process(), so live/offline parity is free (no twin). Multiplication
    // is UNCONDITIONAL: x1.0 is bit-exact in IEEE754, the reference hash
    // is safe by construction.
    const float master = master_gain_.load(std::memory_order_relaxed);
    float mpl = 0.0f;
    float mpr = 0.0f;
    for (uint32_t j = 0; j < frame_count; ++j) {
        const float l = output[j * 2] * master;
        const float r = output[j * 2 + 1] * master;
        output[j * 2] = l;
        output[j * 2 + 1] = r;
        const float al = l < 0.0f ? -l : l;
        const float ar = r < 0.0f ? -r : r;
        if (al > mpl) mpl = al;
        if (ar > mpr) mpr = ar;
    }
    master_peak_left_.store(mpl, std::memory_order_relaxed);
    master_peak_right_.store(mpr, std::memory_order_relaxed);

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

    // Process through chain, en mesurant le pic APRES CHAQUE device (T3 :
    // VU inter-device). Le tap est RT-safe (boucle de pic + store atomique).
    const size_t chain_off = track_index < track_chain_offset_.size()
                                 ? track_chain_offset_[track_index] : 0;
    size_t node_j = 0;
    for (auto& processor : track.chain) {
        processor->process(output, output, frame_count, position_samples);
        float npl = 0.0f, npr = 0.0f;
        for (uint32_t i = 0; i < frame_count; ++i) {
            const float al = std::fabs(output[i * 2]);
            const float ar = std::fabs(output[i * 2 + 1]);
            if (al > npl) npl = al;
            if (ar > npr) npr = ar;
        }
        const size_t gi = chain_off + node_j;
        if (gi < num_nodes_) {
            node_peak_left_[gi].store(npl, std::memory_order_relaxed);
            node_peak_right_[gi].store(npr, std::memory_order_relaxed);
        }
        ++node_j;
    }

    // F2 : panoramique en SORTIE de piste (post-chain). Post-chain
    // volontairement : un instrument (ex Dexed) IGNORE son entree et genere un
    // signal centre - le paner avant sa chaine ne ferait rien.
    //   Loi LINEAIRE centre-neutre (pas puissance egale) : le canal proche
    //   reste a l'unite, le canal oppose descend lineairement. Choix impose
    //   par la neutralite du CENTRE (pan 0 == inchange) - obligatoire pour ne
    //   pas alterer le hash offline deterministe ni la loudness des projets
    //   existants. La puissance egale mettrait le centre a -3 dB (casse les
    //   hash) ou le hard-pan a +3 dB (risque de clip) ET creerait une
    //   discontinuite de -3 dB en frolant le centre. gl,gr continus en 0.
    // pan -1 (G) .. 0 (centre) .. +1 (D). Le metering suit (post-pan).
    const float pan_value = track.pan.load(std::memory_order_relaxed);
    if (pan_value != 0.0f) {
        const float gl = pan_value <= 0.0f ? 1.0f : (1.0f - pan_value);
        const float gr = pan_value >= 0.0f ? 1.0f : (1.0f + pan_value);
        for (uint32_t i = 0; i < frame_count; ++i) {
            output[i * 2] *= gl;
            output[i * 2 + 1] *= gr;
        }
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

    // T3 : metrologie par DEVICE (VU inter-device). Table plate + offset/piste.
    node_ids_.clear();
    track_chain_offset_.clear();
    track_chain_offset_.reserve(tracks_.size());
    for (auto& track : tracks_) {
        track_chain_offset_.push_back(node_ids_.size());
        for (auto& processor : track.chain) {
            node_ids_.push_back(processor->getId());
        }
    }
    num_nodes_ = node_ids_.size();
    const size_t alloc_n = num_nodes_ ? num_nodes_ : 1;
    node_peak_left_ = std::make_unique<std::atomic<float>[]>(alloc_n);
    node_peak_right_ = std::make_unique<std::atomic<float>[]>(alloc_n);
    for (size_t i = 0; i < num_nodes_; ++i) {
        node_peak_left_[i].store(0.0f, std::memory_order_relaxed);
        node_peak_right_[i].store(0.0f, std::memory_order_relaxed);
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

ProcessorNode* AudioGraph::getNodeById(const std::string& id) noexcept {
    // v9 : lookup node de chaine par proc id (fenetre GUI a la demande). Le
    // graphe est immuable une fois actif ; le control thread le sonde via le
    // slot atomique. Lineaire sur les chaines (peu de nodes) - pas de map.
    for (auto& track : tracks_) {
        for (auto& node : track.chain) {
            if (node && node->getId() == id) {
                return node.get();
            }
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

    // T3 : pic par DEVICE (id = proc id) - le web mappe procId -> VU.
    for (size_t k = 0; k < num_nodes_; ++k) {
        meters.emplace_back(
            node_ids_[k],
            node_peak_left_[k].load(std::memory_order_relaxed),
            node_peak_right_[k].load(std::memory_order_relaxed)
        );
    }

    return meters;
}

}  // namespace daw::graph
