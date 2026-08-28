// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file audio_device.h
 * @brief Wrapper around miniaudio device.
 */

#include "ring_buffer.h"
#include "audio_callback.h"
#include "../graph/audio_graph.h"
#include "../transport/transport_state.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <functional>
#include <vector>

// Forward declare miniaudio types to avoid including the header here
struct ma_device;
struct ma_context;

namespace daw::audio {

/**
 * Audio device configuration.
 */
struct AudioDeviceConfig {
    uint32_t sample_rate = 48000;
    uint32_t buffer_size_frames = 512;  // Latency tradeoff
    std::string device_name;            // Empty = default device
    bool use_null_backend = false;      // For silent testing
    // SPIKE LATENCE s2 : WASAPI exclusif opt-in (le readback share= de
    // la ligne audio-negotiation fait foi, miniaudio retombe en silence)
    bool exclusive_mode = false;
};

/**
 * Audio device state.
 */
enum class AudioDeviceState {
    Uninitialized,
    Initialized,
    Running,
    Stopped,
    Error
};

/**
 * Audio device info for enumeration.
 */
struct AudioDeviceInfo {
    std::string name;
    bool is_default = false;
};

/**
 * List available playback devices.
 *
 * @return Vector of device info
 */
std::vector<AudioDeviceInfo> listPlaybackDevices();

/**
 * Wrapper around miniaudio device.
 *
 * Manages the audio device lifecycle and provides communication with
 * the audio callback via lock-free ring buffers.
 */
class AudioDevice {
public:
    AudioDevice();
    ~AudioDevice();

    // Non-copyable, non-movable
    AudioDevice(const AudioDevice&) = delete;
    AudioDevice& operator=(const AudioDevice&) = delete;
    AudioDevice(AudioDevice&&) = delete;
    AudioDevice& operator=(AudioDevice&&) = delete;

    /**
     * Initialize the audio device.
     *
     * @param config Device configuration
     * @return true on success
     */
    bool initialize(const AudioDeviceConfig& config);

    /**
     * Shutdown the audio device.
     */
    void shutdown();

    /**
     * Start audio processing.
     *
     * @return true on success
     */
    bool start();

    /**
     * Stop audio processing.
     */
    void stop();

    /**
     * Get current device state.
     */
    AudioDeviceState getState() const { return state_; }

    /**
     * Get the actual sample rate (may differ from requested).
     */
    uint32_t getSampleRate() const { return actual_sample_rate_; }

    /**
     * Get the actual buffer size.
     */
    uint32_t getBufferSize() const { return actual_buffer_size_; }

    /** Lot P : le mode exclusif REELLEMENT obtenu (readback, pas la
     *  demande - miniaudio retombe en partage en silence). */
    bool isExclusive() const { return actual_exclusive_; }

    /** A6 (mesure) : la forme reelle des callbacks depuis le start -
     *  {min, max, partiels (non multiples de 256), total}. */
    struct CallbackShape {
        uint32_t min_frames;
        uint32_t max_frames;
        uint64_t partial;
        uint64_t total;
    };
    CallbackShape callbackShape() const {
        return { cb_min_frames_.load(std::memory_order_relaxed),
                 cb_max_frames_.load(std::memory_order_relaxed),
                 cb_partial_count_.load(std::memory_order_relaxed),
                 cb_total_count_.load(std::memory_order_relaxed) };
    }

    /**
     * Get the device name.
     */
    const std::string& getDeviceName() const { return device_name_; }

    /**
     * Get buffer underrun count.
     */
    uint64_t getBufferUnderrunCount() const {
        return buffer_underrun_count_.load(std::memory_order_relaxed);
    }

    // --- Communication with audio thread ---

    /**
     * Send a command to the audio thread.
     *
     * @param cmd The command to send
     * @return true if command was queued, false if buffer full
     */
    bool sendCommand(const AudioCommandMessage& cmd);

    /**
     * Poll for telemetry from the audio thread.
     *
     * @return Latest telemetry, or nullopt if none available
     */
    std::optional<AudioTelemetry> pollTelemetry();

    /**
     * A retired graph plus the callback-generation snapshot taken at its
     * swap. Free it only when isRetireSafe() says so AND use_count()==1
     * (control-side readers may still hold transient copies).
     */
    struct RetiredGraph {
        std::shared_ptr<graph::AudioGraph> graph;
        uint64_t gen_at_swap = 0;
    };

    /**
     * Set the active audio graph.
     *
     * Publishes the raw pointer to the audio callback (lock-free slot) and
     * the shared_ptr to control-side readers. The audio callback never
     * touches refcounts: reclamation is generation-gated on the control
     * side (see isRetireSafe).
     *
     * @param graph New graph (shared ownership)
     * @return The previous graph with its swap generation snapshot
     */
    RetiredGraph setActiveGraph(std::shared_ptr<graph::AudioGraph> graph);

    /**
     * True once the audio callback can no longer be reading r.graph:
     * generation even at swap (no callback in flight), generation advanced
     * past the snapshot (that callback exited), or device not running.
     */
    bool isRetireSafe(const RetiredGraph& r) const;

    /**
     * Slot readers (e.g. WebSocketServer telemetry) load a shared_ptr copy
     * from this atomic slot before each use. The slot outlives all readers:
     * it lives as long as the AudioDevice.
     */
    const std::atomic<std::shared_ptr<graph::AudioGraph>>* getActiveGraphSlot() const {
        return &active_graph_;
    }

    /**
     * Get the transport state.
     */
    transport::TransportState& getTransport() { return transport_; }
    const transport::TransportState& getTransport() const { return transport_; }

private:
    // miniaudio handles (opaque pointers)
    std::unique_ptr<ma_context> context_;
    std::unique_ptr<ma_device> device_;

    // State
    AudioDeviceState state_ = AudioDeviceState::Uninitialized;
    uint32_t actual_sample_rate_ = 0;
    uint32_t actual_buffer_size_ = 0;
    bool actual_exclusive_ = false;  // readback, jamais la demande
    std::string device_name_;

    // Ring buffers for thread communication
    CommandRingBuffer command_buffer_;
    TelemetryRingBuffer telemetry_buffer_;

    // Control-side slot: WebSocketServer & co. take shared_ptr copies via
    // atomic load. NOT read by the audio callback (not lock-free on MSVC).
    std::atomic<std::shared_ptr<graph::AudioGraph>> active_graph_;

    // Audio-side slot: raw pointer, lock-free (static_assert in
    // audio_callback.h). The ONLY graph access the callback performs.
    std::atomic<graph::AudioGraph*> active_graph_raw_{nullptr};

    // Callback generation counter (odd = inside a callback). See GenGuard.
    std::atomic<uint64_t> callback_generation_{0};

    // Transport state
    transport::TransportState transport_;

    // Telemetry counters
    std::atomic<uint64_t> buffer_underrun_count_{0};
    // A6 (mesure) : forme des callbacks (min/max frame_count, partiels)
    std::atomic<uint32_t> cb_min_frames_{0xFFFFFFFFu};
    std::atomic<uint32_t> cb_max_frames_{0};
    std::atomic<uint64_t> cb_partial_count_{0};
    std::atomic<uint64_t> cb_total_count_{0};

    // Callback context (passed to audio thread)
    AudioCallbackContext callback_context_;

public:
    /**
     * S8a: attach the master tap ring. MUST be called before
     * initialize()/start() - the pointer is read by the audio callback
     * without synchronization.
     */
    void setTapRing(TapRing* ring) { callback_context_.tap_ring = ring; }

    /**
     * Vague 3 : attach the live MIDI queue + stats. MUST be called before
     * initialize()/start() (read by the callback without synchronization).
     * Null = no live MIDI (the silence path behaves exactly as before).
     */
    void setLiveMidi(daw::midi::LiveMidiQueue* queue, daw::midi::LiveMidiStats* stats) {
        callback_context_.midi_in = queue;
        callback_context_.midi_stats = stats;
    }
};

}  // namespace daw::audio
