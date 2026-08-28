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
#include <map>
#include <string>
#include <vector>

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

    /**
     * COLD RESTART after a detected death (c-2): reap the corpse, reset the
     * heartbeat (the old life's beats would fake readiness), spawn a fresh
     * child on the SAME segment and wait for its ceremony. The ring's param
     * state survives, so the new child re-applies the latest value on its
     * first block - the restart is cold plugin-side, seamless ring-side.
     * Control thread only. Returns false (with error()) on failure.
     */
    bool restartChild(uint32_t timeout_ms = 10000);

    /** TEST HOOK: kill the child mid-flight (no shutdown flag, segment
     *  kept mapped) - the deterministic stand-in for a real crash. */
    void terminateChildForTest();

    /** Cold restarts performed so far (telemetry). */
    [[nodiscard]] uint32_t restartCount() const noexcept { return restart_count_; }

    /** Latest-value parameter channel (last state wins). */
    void setParam(uint32_t param_id, double normalized);

    /**
     * MIDI (v8) : pousse UN evenement de note pour le bloc courant (thread
     * de controle, FIFO SPSC). L'enfant le draine dans l'IEventList VST3
     * avant process(). C'est le canal qui fait SONNER un instrument.
     * sample_offset = position dans le bloc (0..blockSize-1).
     */
    void sendMidiNote(bool note_on, uint8_t pitch, uint8_t velocity,
                      uint8_t channel, uint32_t sample_offset);

    // ---- State side-channel (2.5-etat) -----------------------------------
    // The blob travels via `<segment>.state`, never through the ring.

    /**
     * Stage a state blob for the NEXT child spawn (start or restart):
     * the child restores it during its ceremony, processor-first,
     * before its heartbeat says ready. Callable before start().
     */
    void setPendingState(std::vector<uint8_t> blob) {
        pending_state_ = std::move(blob);
    }

    /**
     * Ask the LIVE child to serialize its state and read the blob back.
     * CONTROL THREAD ONLY (bounded wait). Returns false on timeout or
     * when the plugin refused getState (error() explains).
     */
    bool saveState(std::vector<uint8_t>& out, uint32_t timeout_ms = 5000);

    /** Path of the state side-channel file (valid after start()). */
    [[nodiscard]] std::string statePath() const { return segment_path_ + ".state"; }

    /**
     * Synchronous block exchange - CONTROL THREAD ONLY.
     * Planar in/out, n <= kRingBlockSize frames.
     */
    bool processBlockSync(const float* in_l, const float* in_r,
                          float* out_l, float* out_r,
                          uint32_t n, uint32_t timeout_ms = 2000,
                          int64_t position_samples = 0);

    /** v12 : tempo (milli-BPM) + play/stop pour le ProcessContext du
     *  plugin (offline : toujours "playing"). Thread de controle. */
    void setTransportContext(bool playing, int64_t tempo_milli_bpm) noexcept;

    /** Control-thread liveness check via the process handle (timeout 0). */
    bool childAlive();

    /** PDC ecrivain (v7) : latence interne declaree par le plugin
     *  (ecrite par l'enfant avant son heartbeat ready ; 0 sans ring). */
    [[nodiscard]] uint32_t pluginLatencySamples() const {
        return ring_ ? static_cast<uint32_t>(
                           ring_->plugin_latency_samples.load(
                               std::memory_order_acquire))
                     : 0;
    }

    /**
     * Fenetre GUI a la demande (v9) : ecrit l'etat DESIRE de la fenetre du
     * plugin dans le ring (0/1). L'enfant compare a l'etat courant de sa
     * fenetre a chaque tour de boucle serve et ouvre/ferme. No-op si le pont
     * n'est pas demarre. Thread de controle (le message kEditor).
     */
    void setEditorOpen(bool open) {
        if (ring_)
            ring_->editor_open.store(open ? 1u : 0u, std::memory_order_release);
    }

    [[nodiscard]] bool isRunning() const { return ring_ != nullptr; }
    [[nodiscard]] const std::string& error() const { return error_; }

    /**
     * The mapped segment, for a ProxyNode to drive (one-frame pipeline).
     * Valid between start() and stop(). ONE producer per ring: never drive
     * the same ring through both a ProxyNode and processBlockSync().
     */
    [[nodiscard]] SharedAudioRing* ring() noexcept { return ring_; }

    /**
     * Fenetrage v1 (verrue assumee, arbitrage utilisateur 2026-08-24) :
     * quand ON, chaque enfant spawne avec --editor et ouvre la GUI
     * native du plugin dans une fenetre OS sur le bureau. Engine-wide
     * (--editors), consulte a CHAQUE spawn - y compris les restarts.
     */
    static void setSpawnEditors(bool on) { spawn_editors_ = on; }
    static bool spawnEditors() { return spawn_editors_; }

private:
    inline static bool spawn_editors_ = false;
    SharedAudioRing* ring_ = nullptr;
    std::string segment_path_;
    std::string error_;
    uint64_t next_seq_ = 0;

    // Spawn recipe, kept for cold restarts
    std::string host_exe_;
    std::string module_path_;
    std::string class_uid_;
    uint32_t restart_count_ = 0;

    // 2.5-etat: blob staged for the next spawn (written to statePath()
    // just before the child starts; empty = nothing staged)
    std::vector<uint8_t> pending_state_;

    // v5: latest value per param id, control-side. The FIFO is CONSUMED
    // by the child, so a cold restart replays from this cache (the old
    // single slot survived restarts by accident; the queue cannot).
    std::map<uint32_t, double> last_params_;

    // Opaque platform handles (Windows: HANDLE file/mapping/process;
    // POSIX: fd + pid)
    void* map_handle_ = nullptr;
    void* file_handle_ = nullptr;
    void* process_handle_ = nullptr;
    int64_t child_pid_ = 0;

    bool createSegment();
    bool spawnChild(const std::string& host_exe, const std::string& module_path,
                    const std::string& class_uid);
    bool waitChildReady(uint32_t timeout_ms);
    void reapChildHandle();
    void unmapSegment();
};

}  // namespace daw::host
