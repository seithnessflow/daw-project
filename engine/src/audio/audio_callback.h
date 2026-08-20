#pragma once

/**
 * @file audio_callback.h
 * @brief Real-time audio callback - THE SACRED THREAD
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                         ⚠️  SACRED THREAD RULES  ⚠️                        ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  This callback runs on the audio driver's real-time thread.              ║
 * ║  ANY violation of these rules WILL cause audio glitches.                 ║
 * ║                                                                          ║
 * ║  ABSOLUTELY FORBIDDEN in this callback:                                  ║
 * ║                                                                          ║
 * ║  ❌ Memory allocation (new, malloc, std::vector::push_back, etc.)        ║
 * ║  ❌ Memory deallocation (delete, free)                                   ║
 * ║  ❌ Mutex, semaphore, or any blocking synchronization                    ║
 * ║  ❌ System calls (read, write, open, close, stat, etc.)                  ║
 * ║  ❌ File I/O of any kind                                                 ║
 * ║  ❌ Network I/O of any kind                                              ║
 * ║  ❌ Logging (std::cout, printf, spdlog, etc.)                            ║
 * ║  ❌ Exceptions (throw, try/catch)                                        ║
 * ║  ❌ Virtual function calls through unknown vtables                       ║
 * ║  ❌ std::function or std::any (they allocate)                            ║
 * ║  ❌ String operations that might allocate                                ║
 * ║  ❌ Container operations that might reallocate                           ║
 * ║                                                                          ║
 * ║  ALLOWED:                                                                ║
 * ║                                                                          ║
 * ║  ✅ Lock-free atomics (std::atomic with appropriate memory ordering)     ║
 * ║  ✅ Lock-free SPSC ring buffers                                          ║
 * ║  ✅ Pre-allocated buffers                                                ║
 * ║  ✅ Inline math operations                                               ║
 * ║  ✅ Reading from const data structures                                   ║
 * ║  ✅ Atomic pointer swaps for graph updates                               ║
 * ║                                                                          ║
 * ║  If you're not sure, DON'T DO IT.                                        ║
 * ║  A single allocation can cause a 10ms stall → audible click.             ║
 * ║                                                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

#include "ring_buffer.h"
#include "../graph/audio_graph.h"
#include "../transport/transport_state.h"

#include <atomic>
#include <cstdint>

namespace daw::audio {

/**
 * Number of audio channels (stereo).
 */
constexpr uint32_t kChannelCount = 2;

/**
 * Fixed internal block size for audio processing.
 *
 * The callback may receive any frame_count from the driver, but the graph
 * always processes in fixed-size chunks. This ensures:
 * - Predictable buffer sizes (no allocation dependent on driver)
 * - VST3 compliance (maxSamplesPerBlock declared at setup)
 * - No clipping/masking of driver requests
 *
 * 256 frames = ~5.3ms @ 48kHz
 */
constexpr uint32_t INTERNAL_BLOCK_SIZE = 256;

// Forward declarations
class AudioDevice;

/**
 * Context passed to the audio callback.
 * All pointers must remain valid for the lifetime of audio processing.
 */
struct AudioCallbackContext {
    // Ring buffers for thread communication
    CommandRingBuffer* command_buffer = nullptr;
    TelemetryRingBuffer* telemetry_buffer = nullptr;

    // Atomic pointer to current audio graph (swapped by control thread)
    std::atomic<graph::AudioGraph*>* active_graph = nullptr;

    // Transport state (atomics for lock-free access)
    transport::TransportState* transport = nullptr;

    // Telemetry counters
    std::atomic<uint64_t>* buffer_underrun_count = nullptr;

    // Sample rate for calculations
    uint32_t sample_rate = 48000;
};

/**
 * The audio callback function.
 *
 * This function is called by miniaudio from the audio driver thread.
 * All sacred thread rules apply.
 *
 * @param device miniaudio device (opaque, do not use directly)
 * @param output Output buffer to fill with audio samples
 * @param input Input buffer (unused in playback mode)
 * @param frame_count Number of frames to process
 *
 * Frame layout: interleaved stereo (L0, R0, L1, R1, ...)
 */
void audioCallback(
    void* device,
    void* output,
    const void* input,
    uint32_t frame_count
) noexcept;

/**
 * Process commands from the control thread.
 * Called at the start of each audio callback.
 *
 * @param ctx Callback context
 */
void processCommands(AudioCallbackContext& ctx) noexcept;

/**
 * Send telemetry to the control thread.
 * Called at the end of each audio callback.
 *
 * @param ctx Callback context
 * @param peak_left Left channel peak (0.0 to 1.0+)
 * @param peak_right Right channel peak (0.0 to 1.0+)
 */
void sendTelemetry(
    AudioCallbackContext& ctx,
    float peak_left,
    float peak_right
) noexcept;

/**
 * Calculate peak amplitude from a buffer.
 *
 * @param buffer Audio samples
 * @param frame_count Number of frames
 * @param channel Channel index (0 = left, 1 = right)
 * @return Peak amplitude (absolute value)
 */
float calculatePeak(
    const float* buffer,
    uint32_t frame_count,
    uint32_t channel
) noexcept;

}  // namespace daw::audio
