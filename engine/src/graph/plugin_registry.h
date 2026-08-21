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

#include <cstddef>
#include <map>
#include <string>

namespace daw::graph {

struct PluginInstanceHandle {
    // 2.4: child process handle, instance id, shared-memory channel,
    // declared latency. Empty until the host exists.
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
