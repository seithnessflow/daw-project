// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file proxy_node.h
 * @brief ProcessorNode proxying audio through the shared ring (ADR-017).
 *
 * PIPELINED EXCHANGE (TODO 2.4c-1, depth revised on first live evidence):
 * process() deposits block N into the ring and returns block N-depth - wet
 * if the child delivered it, DRY time-aligned bypass otherwise (counted in
 * blocks_missed, NEVER waited for). depth = blocks per DEVICE callback
 * (the driver delivers them back-to-back; one block of headroom loses the
 * race ~1/3 of the time - measured 534/1875). Output lags input by
 * depth blocks; declared via getLatencySamples() in 2.4d. The first depth
 * blocks return silence (pipeline fill), which is the latency showing,
 * not an incident.
 *
 * AUDIO THREAD - sacred rules: this node touches only the ring's lock-free
 * atomics and fixed arrays. No allocation, no syscalls, no waiting. Child
 * death is NOT this node's business: the control thread watches the process
 * handle (PluginBridge::childAlive); here a dead child just looks like
 * "block not ready" and becomes counted bypass.
 *
 * ONE PRODUCER PER RING: this node (live callback) and
 * PluginBridge::processBlockSync (offline/control) both advance input_seq
 * and must never drive the SAME ring concurrently. reset() deliberately
 * does NOT rewind the sequence: the child keys on it; one stale block after
 * a seek self-heals.
 *
 * Lifetime: ring and counter belong to the registry's PluginInstanceHandle
 * (control side), which SURVIVES graph rebuilds - a rebuild re-attaches a
 * fresh ProxyNode to the same ring (ADR-017: rebuild = handle transfer,
 * never re-instantiation).
 */

#include "../graph/processor_node.h"
#include "shared_audio_ring.h"

#include <atomic>
#include <string>

namespace daw::host {

class ProxyNode final : public graph::ProcessorNode {
public:
    static constexpr const char* TYPE = "host.proxy";

    /** depth: blocks per device callback; clamped to [1, kRingSlots - 2]
     *  so a deposit never overwrites a slot still being read.
     *  bypass (2.4d, document state): the node still deposits (pipeline
     *  kept warm for a click-managed un-bypass) but always returns the
     *  DRY time-aligned block - same latency wet or dry, no time jump. */
    ProxyNode(std::string id, SharedAudioRing* ring,
              std::atomic<uint64_t>* blocks_missed, uint32_t depth = 1,
              bool bypass = false)
        : id_(std::move(id)), ring_(ring), missed_(blocks_missed),
          depth_(depth < 1 ? 1 : (depth > kRingSlots - 2 ? kRingSlots - 2 : depth)),
          bypass_(bypass) {}

    /** The pipeline's latency, from the LIVE depth - never a constant. */
    [[nodiscard]] uint32_t getLatencySamples() const noexcept override {
        return depth_ * kRingBlockSize;
    }

    void process(float* output, const float* input, uint32_t frame_count,
                 int64_t position_samples) noexcept override;

    [[nodiscard]] const std::string& getType() const noexcept override { return type_; }
    [[nodiscard]] const std::string& getId() const noexcept override { return id_; }

    // Parameters flow through the control side (PluginBridge::setParam ->
    // ring param channel), never through this graph-facing string API
    bool setParameter(const std::string&, float) noexcept override { return false; }
    [[nodiscard]] float getParameter(const std::string&) const noexcept override { return 0.0f; }

    void prepare(uint32_t, uint32_t) override {}
    void reset() noexcept override {}

private:
    std::string type_{TYPE};
    std::string id_;
    SharedAudioRing* ring_ = nullptr;
    std::atomic<uint64_t>* missed_ = nullptr;
    uint32_t depth_ = 1;
    bool bypass_ = false;
};

}  // namespace daw::host
