// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file plugin_registry.h
 * @brief Control-side registry of out-of-process plugin instances (ADR-017).
 *
 * Instances are keyed by their document node id and SURVIVE graph rebuilds:
 * a rebuild re-attaches proxy nodes to existing handles, it never
 * re-instantiates a plugin. This is what reduces "transfer node state at
 * swap" (AUDIT-2 R2) to a handle copy.
 *
 * R1+R2 lands the STRUCTURE; the handle contents (child process, instance
 * id, shared-memory channel, latency) land with the VST3 host (2.4).
 *
 * Threading: control thread only. Never touched by the audio callback.
 */

#include "../host/plugin_bridge.h"

#include <atomic>
#include <cstddef>
#include <map>
#include <memory>
#include <string>

namespace daw::graph {

struct PluginInstanceHandle {
    // 2.4c-1: the live child + its ring. The handle owns the bridge; graph
    // rebuilds re-attach ProxyNodes to bridge->ring() without touching the
    // child (that is the whole point of this registry). blocks_missed is
    // written by the audio callback (relaxed), read by telemetry.
    // Declared latency joins in 2.4d.
    std::unique_ptr<daw::host::PluginBridge> bridge;
    std::atomic<uint64_t> blocks_missed{0};

    PluginInstanceHandle() = default;
    PluginInstanceHandle(const PluginInstanceHandle&) = delete;
    PluginInstanceHandle& operator=(const PluginInstanceHandle&) = delete;
};

class PluginInstanceRegistry {
public:
    /** Existing instance for this document node, or nullptr. */
    PluginInstanceHandle* find(const std::string& node_id) {
        auto it = instances_.find(node_id);
        return it == instances_.end() ? nullptr : &it->second;
    }

    /** Instance for this node, created empty if absent. */
    PluginInstanceHandle& ensure(const std::string& node_id) {
        return instances_[node_id];
    }

    [[nodiscard]] std::size_t size() const { return instances_.size(); }

private:
    std::map<std::string, PluginInstanceHandle> instances_;
};

}  // namespace daw::graph
