// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file sync_proxy_node.h
 * @brief OFFLINE twin of ProxyNode (c-2): blocking bounded exchange.
 *
 * CONTROL THREAD ONLY - never the audio callback. The offline render has
 * no real-time constraint, so it uses the ring's SYNC path
 * (PluginBridge::processBlockSync): block N in, block N out, ZERO latency,
 * bit-exact and deterministic. A timeout or a dead child sets failed() and
 * outputs silence - the renderer turns that into a hard render error, it
 * never ships fake audio.
 *
 * ONE producer per ring: a ring driven by a SyncProxyNode must never also
 * be driven by a live ProxyNode. The offline renderer owns its own bridges
 * precisely for that.
 */

#include "../graph/processor_node.h"
#include "plugin_bridge.h"

#include <string>

namespace daw::host {

class SyncProxyNode final : public graph::ProcessorNode {
public:
    static constexpr const char* TYPE = "host.sync-proxy";

    /** bypass (2.4d, document state): identity pass-through, ZERO latency
     *  (offline has no pipeline to keep warm), bridge never touched - a
     *  bypassed node may carry bridge == nullptr (no child spawned). */
    SyncProxyNode(std::string id, PluginBridge* bridge, bool bypass = false)
        : id_(std::move(id)), bridge_(bridge), bypass_(bypass) {}

    void process(float* output, const float* input, uint32_t frame_count,
                 int64_t position_samples) noexcept override;

    [[nodiscard]] const std::string& getType() const noexcept override { return type_; }
    [[nodiscard]] const std::string& getId() const noexcept override { return id_; }
    bool setParameter(const std::string&, float) noexcept override { return false; }
    [[nodiscard]] float getParameter(const std::string&) const noexcept override { return 0.0f; }
    void prepare(uint32_t, uint32_t) override {}
    void reset() noexcept override {}

    /** True once any exchange failed - the render must be declared failed. */
    [[nodiscard]] bool failed() const noexcept { return failed_; }

private:
    std::string type_{TYPE};
    std::string id_;
    PluginBridge* bridge_ = nullptr;
    bool bypass_ = false;
    bool failed_ = false;
};

}  // namespace daw::host
