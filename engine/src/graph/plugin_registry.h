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

    // c-2 crash handling, maintained by the control loop's poll:
    // child_alive mirrors the last observed state (false during a death
    // window and permanently once the restart budget is exhausted);
    // child_restarts counts restart ATTEMPTS (bounded by the control loop).
    // Both feed EngineState telemetry.
    std::atomic<bool> child_alive{true};
    std::atomic<uint32_t> child_restarts{0};

    // Fenetrage v1 (v6) : dernier gui_edit_seq observe par la boucle de
    // controle - un delta programme la capture d'etat debouncee (le
    // reglage a la fenetre survit et voyage par les stems).
    uint64_t gui_edits_seen{0};

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

    /** Visit every handle (control thread; used by the liveness poll). */
    template <typename F>
    void forEach(F&& fn) {
        for (auto& [node_id, handle] : instances_) {
            fn(node_id, handle);
        }
    }

    /**
     * V1.5 / AUDIT-4 A4-5: evict every instance whose node id is not in
     * `keep`. Without this, a vst3 node removed from the document left
     * its child ZOMBIE: yield-spinning at 100% of a core forever, and
     * resurrected by the liveness poll if it died. stop() ends the child
     * before the handle (and its ring) is destroyed.
     *
     * @param keep predicate: true = this node id is still in the document
     * @return number of instances evicted
     */
    template <typename Keep>
    std::size_t evictMissing(Keep&& keep) {
        std::size_t evicted = 0;
        for (auto it = instances_.begin(); it != instances_.end();) {
            if (!keep(it->first)) {
                if (it->second.bridge) it->second.bridge->stop();
                it = instances_.erase(it);
                ++evicted;
            } else {
                ++it;
            }
        }
        return evicted;
    }

private:
    std::map<std::string, PluginInstanceHandle> instances_;
};

}  // namespace daw::graph
