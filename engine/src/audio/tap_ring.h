// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file tap_ring.h
 * @brief S8a - the master tap: post-master audio leaves the sacred
 * thread through a lock-free SPSC ring; the control thread drains it
 * to the LOCAL tab over the loopback WebSocket (the jam road's first
 * meter: engine -> tab; the tab ships it P2P later).
 *
 * Sacred-thread rules: the callback is the SINGLE writer and never
 * touches read_idx (strict SPSC). Ring full = DROP NEWEST on the
 * audio side (counted in dropped, visible in telemetry) - the
 * callback never waits, never contends. All atomics lock-free
 * (asserted with the others in audio_callback.h's family).
 *
 * 64 slots x 256 frames = ~341 ms of slack at 48 kHz: the control
 * loop drains every tick (~1 ms), a drop means the control thread
 * stalled for a third of a second - worth seeing, never worth
 * blocking audio for.
 */

#include <atomic>
#include <cstdint>
#include <cstring>

namespace daw::audio {

struct TapRing {
    static constexpr uint32_t kSlots = 64;       // power of two
    static constexpr uint32_t kBlockFrames = 256;  // == INTERNAL_BLOCK_SIZE
    static constexpr uint32_t kBlockSamples = kBlockFrames * 2;  // stereo

    std::atomic<bool> enabled{false};
    std::atomic<uint64_t> write_idx{0};
    std::atomic<uint64_t> read_idx{0};
    std::atomic<uint64_t> dropped{0};
    float blocks[kSlots][kBlockSamples];

    // Staging: loop wraps produce PARTIAL sub-blocks; they accumulate
    // here (AUDIO-THREAD-ONLY fields, no atomics needed) so the stream
    // has no holes - a slot publishes only when 256 frames are full.
    float staging[kBlockSamples];
    uint32_t staged_frames = 0;

    /** AUDIO THREAD. Feed any number of interleaved stereo frames. */
    void pushSamples(const float* interleaved, uint32_t frames) noexcept {
        if (!enabled.load(std::memory_order_relaxed)) {
            staged_frames = 0;  // a disabled tap never carries stale audio
            return;
        }
        while (frames > 0) {
            const uint32_t take =
                (frames < kBlockFrames - staged_frames)
                    ? frames : (kBlockFrames - staged_frames);
            std::memcpy(staging + staged_frames * 2, interleaved,
                        take * 2 * sizeof(float));
            staged_frames += take;
            interleaved += take * 2;
            frames -= take;
            if (staged_frames == kBlockFrames) {
                staged_frames = 0;
                const uint64_t w = write_idx.load(std::memory_order_relaxed);
                const uint64_t r = read_idx.load(std::memory_order_acquire);
                if (w - r >= kSlots) {
                    dropped.fetch_add(1, std::memory_order_relaxed);
                    continue;  // drop NEWEST: audio never waits
                }
                std::memcpy(blocks[w % kSlots], staging,
                            kBlockSamples * sizeof(float));
                write_idx.store(w + 1, std::memory_order_release);
            }
        }
    }
};

static_assert(std::atomic<uint64_t>::is_always_lock_free &&
              std::atomic<bool>::is_always_lock_free,
              "tap ring atomics must be lock-free (sacred thread)");

}  // namespace daw::audio
