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
     * Set the active audio graph (atomic swap of shared ownership).
     *
     * The audio thread and telemetry readers each acquire their own
     * shared_ptr copy before use, so the previous graph stays alive until
     * its last reader releases it.
     *
     * @param graph New graph (shared ownership)
     * @return Previous graph. The caller (control thread) must keep it in a
     *         retirement queue and destroy it only once no reader holds a
     *         reference (use_count() == 1). Never let the audio thread hold
     *         the last reference: deallocation must happen on the control
     *         thread.
     */
    std::shared_ptr<graph::AudioGraph> setActiveGraph(std::shared_ptr<graph::AudioGraph> graph);

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
    std::string device_name_;

    // Ring buffers for thread communication
    CommandRingBuffer command_buffer_;
    TelemetryRingBuffer telemetry_buffer_;

    // Active audio graph. Readers (audio thread, telemetry) take shared_ptr
    // copies via atomic load; the control thread swaps via exchange.
    std::atomic<std::shared_ptr<graph::AudioGraph>> active_graph_;

    // Transport state
    transport::TransportState transport_;

    // Telemetry counters
    std::atomic<uint64_t> buffer_underrun_count_{0};

    // Callback context (passed to audio thread)
    AudioCallbackContext callback_context_;
};

}  // namespace daw::audio
