// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file shared_audio_ring.h
 * @brief The shared-memory segment between engine and plugin host (ADR-017).
 *
 * THIS LAYOUT IS A BINARY CONTRACT BETWEEN TWO EXECUTABLES compiled
 * separately: engine and plugin_host both include this exact header, and
 * the static_asserts below (sizeof + offsetof on every field) turn any
 * silent padding/ordering divergence into a compile error. This is the
 * SCHEMA.md of the binary world - bump kLayoutVersion on ANY change.
 *
 * Concurrency rules (same guarantee family as the sacred thread, new
 * boundary):
 * - Every synchronization field is a std::atomic that MUST be lock-free
 *   (asserted below): std::atomic works across processes only if it lives
 *   physically in the shared segment and is address-free/lock-free.
 * - NO STL mutex ever goes in this segment (a kernel object is not a
 *   memory object; an STL mutex in shared memory is undefined behavior in
 *   a trench coat). Sequence-published double buffers only - the peaks
 *   mold, across a process boundary.
 *
 * Pipelined exchange (decided in TODO 2.4c-1, DEPTH REVISED the same day):
 * the engine deposits block N and collects block N-depth. The original
 * one-frame depth assumed a regular block cadence; reality (first live
 * run, 534/1875 blocks missed): the driver delivers bursts of
 * buffer_size/256 blocks back-to-back microseconds apart, so the child
 * must be given a full DEVICE PERIOD, not a block period. Depth is a
 * NODE-SIDE POLICY (= blocks per device callback, 2 for the 512 default),
 * the layout only provides enough slots (kRingSlots=4 covers depth<=2
 * with write/read separation). Cost: depth blocks of latency, declared
 * via getLatencySamples() in 2.4d. A missing block is NEVER waited for on
 * the audio thread: bypass + incident counter. Child death is detected by
 * the CONTROL thread via the process handle - the callback only knows
 * "block ready or not".
 */

#include <atomic>
#include <cstddef>
#include <cstdint>

namespace daw::host {

inline constexpr uint32_t kRingMagic = 0x52574144;  // 'DAWR'
inline constexpr uint32_t kLayoutVersion = 2;       // v2: 4 slots (pipeline depth 2)
inline constexpr uint32_t kRingBlockSize = 256;     // == audio::INTERNAL_BLOCK_SIZE
inline constexpr uint32_t kRingChannels = 2;
inline constexpr uint32_t kRingSlots = 4;           // power of two; covers depth <= 2

struct SharedAudioRing {
    // ---- Contract header (plain, written once by the engine) ----
    uint32_t magic;
    uint32_t layout_version;
    uint32_t block_size;
    uint32_t sample_rate;

    // ---- Sequencing (block numbers start at 1; 0 = nothing yet) ----
    // Engine: publishes after writing input slot (seq % kRingSlots)
    std::atomic<uint64_t> input_seq;
    // Child: publishes after writing the matching output slot
    std::atomic<uint64_t> output_seq;

    // ---- Parameter channel: latest value wins (the graph policy, here) ----
    // COLD-READ NOTE (2.4c-1): this trio is NOT a seqlock. Single writer
    // bumps param_seq AFTER id/value, so a reader can transiently pair a
    // fresh id with a stale value when SEVERAL params churn - it self-heals
    // one block later. Harmless while exactly one param flows (AGain gain,
    // constant id, the whole c-1 scope). The day the chain carries multiple
    // params (c-2+), upgrade to an odd/even seqlock BEFORE widening use -
    // that is a protocol change, not a layout change.
    std::atomic<uint64_t> param_seq;    // bumped by engine after id/value
    std::atomic<uint32_t> param_id;
    std::atomic<double> param_value;    // normalized 0..1

    // ---- Lifecycle ----
    std::atomic<uint32_t> shutdown;     // engine sets 1; child exits cleanly
    std::atomic<uint64_t> child_heartbeat;  // child bumps per processed block

    // ---- Planar audio, double-buffered: [slot][channel][frame] ----
    float in[kRingSlots][kRingChannels][kRingBlockSize];
    float out[kRingSlots][kRingChannels][kRingBlockSize];
};

// ---- The binary contract, compiler-enforced --------------------------------
static_assert(std::is_standard_layout_v<SharedAudioRing>,
              "shared segment must be standard layout");
static_assert(std::atomic<uint64_t>::is_always_lock_free &&
              std::atomic<uint32_t>::is_always_lock_free &&
              std::atomic<double>::is_always_lock_free,
              "cross-process atomics must be lock-free (address-free)");
static_assert(offsetof(SharedAudioRing, magic) == 0);
static_assert(offsetof(SharedAudioRing, layout_version) == 4);
static_assert(offsetof(SharedAudioRing, block_size) == 8);
static_assert(offsetof(SharedAudioRing, sample_rate) == 12);
static_assert(offsetof(SharedAudioRing, input_seq) == 16);
static_assert(offsetof(SharedAudioRing, output_seq) == 24);
static_assert(offsetof(SharedAudioRing, param_seq) == 32);
static_assert(offsetof(SharedAudioRing, param_id) == 40);
static_assert(offsetof(SharedAudioRing, param_value) == 48);
static_assert(offsetof(SharedAudioRing, shutdown) == 56);
static_assert(offsetof(SharedAudioRing, child_heartbeat) == 64);
static_assert(offsetof(SharedAudioRing, in) == 72);
static_assert(offsetof(SharedAudioRing, out) == 72 + kRingSlots * kRingChannels * kRingBlockSize * 4);
static_assert(sizeof(SharedAudioRing) == 72 + 2 * (kRingSlots * kRingChannels * kRingBlockSize * 4),
              "layout drifted - bump kLayoutVersion and fix BOTH sides");

}  // namespace daw::host
