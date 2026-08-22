// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file plugin_bridge.h
 * @brief Control-side of the engine <-> plugin_host bridge (ADR-017, 2.4c-1).
 *
 * Owns the shared segment (file-backed mapping, portable) and the child
 * process lifecycle. Child DEATH is detected here, on the control thread,
 * via the process handle - never by a reader blocking on the ring.
 *
 * Two access modes on the ring:
 * - processBlockSync(): CONTROL THREAD ONLY (offline render). Bounded wait
 *   with sleep backoff; a timeout is a hard error, not a glitch.
 * - The one-frame pipeline for the audio callback (deposit N, collect N-1,
 *   never wait) is specified in shared_audio_ring.h and lands with the
 *   real-time wiring (2.4c-2): the callback side must stay allocation- and
 *   syscall-free, which this class's sync path is not.
 */

#include "shared_audio_ring.h"

#include <cstdint>
#include <string>

namespace daw::host {

class PluginBridge {
public:
    PluginBridge() = default;
    ~PluginBridge();

    PluginBridge(const PluginBridge&) = delete;
    PluginBridge& operator=(const PluginBridge&) = delete;

    /**
     * Create the segment, spawn plugin_host --serve and wait for its
     * ceremony to succeed (heartbeat becomes nonzero) or fail (child exit).
     *
     * @return true when the child is ready; error() explains otherwise
     */
    bool start(const std::string& host_exe,
               const std::string& module_path,
               const std::string& class_uid,
               uint32_t sample_rate,
               uint32_t timeout_ms = 10000);

    /** Ask the child to exit (shutdown flag), then reap it. */
    void stop();

    /** Latest-value parameter channel (last state wins). */
    void setParam(uint32_t param_id, double normalized);

    /**
     * Synchronous block exchange - CONTROL THREAD ONLY.
     * Planar in/out, n <= kRingBlockSize frames.
     */
    bool processBlockSync(const float* in_l, const float* in_r,
                          float* out_l, float* out_r,
                          uint32_t n, uint32_t timeout_ms = 2000);

    /** Control-thread liveness check via the process handle (timeout 0). */
    bool childAlive();

    [[nodiscard]] bool isRunning() const { return ring_ != nullptr; }
    [[nodiscard]] const std::string& error() const { return error_; }

    /**
     * The mapped segment, for a ProxyNode to drive (one-frame pipeline).
     * Valid between start() and stop(). ONE producer per ring: never drive
     * the same ring through both a ProxyNode and processBlockSync().
     */
    [[nodiscard]] SharedAudioRing* ring() noexcept { return ring_; }

private:
    SharedAudioRing* ring_ = nullptr;
    std::string segment_path_;
    std::string error_;
    uint64_t next_seq_ = 0;

    // Opaque platform handles (Windows: HANDLE file/mapping/process;
    // POSIX: fd + pid)
    void* map_handle_ = nullptr;
    void* file_handle_ = nullptr;
    void* process_handle_ = nullptr;
    int64_t child_pid_ = 0;

    bool createSegment();
    bool spawnChild(const std::string& host_exe, const std::string& module_path,
                    const std::string& class_uid);
    void unmapSegment();
};

}  // namespace daw::host
