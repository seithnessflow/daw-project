// SPDX-License-Identifier: GPL-3.0-or-later
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
#include "tap_ring.h"
#include "../midi/live_midi.h"
#include "../graph/audio_graph.h"
#include "../transport/transport_state.h"

#include <atomic>
#include <cstdint>
#include <memory>

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

// ============================================================================
// COMPILER-ENFORCED SACRED-THREAD GUARANTEE
// Every atomic type shared with the audio callback must be lock-free, and is
// asserted here so a silent betrayal of the written rule cannot survive a
// compilation. std::atomic<std::shared_ptr<T>> is deliberately ABSENT: it is
// NOT lock-free on MSVC and once put a hidden spinlock in this callback
// (AUDIT-2 R4). Sharing a new type with the callback? Assert it here first.
// ============================================================================
static_assert(std::atomic<graph::AudioGraph*>::is_always_lock_free,
              "graph pointer slot must be lock-free");
static_assert(std::atomic<uint64_t>::is_always_lock_free,
              "generation/underrun counters must be lock-free");
static_assert(std::atomic<int64_t>::is_always_lock_free,
              "transport position must be lock-free");
static_assert(std::atomic<bool>::is_always_lock_free,
              "playing/solo/mute flags must be lock-free");
static_assert(std::atomic<float>::is_always_lock_free,
              "gain/peak values must be lock-free");
static_assert(std::atomic<int32_t>::is_always_lock_free,
              "live MIDI target index must be lock-free");

/**
 * Context passed to the audio callback.
 * All pointers must remain valid for the lifetime of audio processing.
 */
struct AudioCallbackContext {
    // Ring buffers for thread communication
    CommandRingBuffer* command_buffer = nullptr;
    TelemetryRingBuffer* telemetry_buffer = nullptr;

    // S8a: the master tap (post-master PCM out to the local tab).
    // Plain pointer set before device start; may stay null (CLI mode).
    TapRing* tap_ring = nullptr;

    // Vague 3 : l'entree MIDI live. File SPSC (producteur = la source, ex.
    // thread WinMM ; consommateur = ce callback), compteurs, et le staging
    // du sous-bloc courant (thread audio seul - le graphe se reconstruit,
    // le contexte non). Pointeurs poses avant start ; null = pas de MIDI.
    daw::midi::LiveMidiQueue* midi_in = nullptr;
    daw::midi::LiveMidiStats* midi_stats = nullptr;
    daw::host::MidiEvent live_midi[daw::midi::kLiveMidiMaxPerBlock];

    // Atomic slot holding the current audio graph, RAW pointer. The callback
    // must stay lock-free and std::atomic<std::shared_ptr> is NOT lock-free
    // on MSVC (a hidden STL spinlock ran in this callback once - AUDIT-2 R4).
    // Ownership and reclamation live on the control side: generation-gated
    // retirement (see callback_generation below and AudioDevice::isRetireSafe).
    const std::atomic<graph::AudioGraph*>* active_graph = nullptr;

    // Callback generation: +1 at entry (odd = inside the callback),
    // +1 at exit (even = outside). The control thread frees a retired graph
    // only once the generation is even or has advanced past its swap
    // snapshot - never on a timer, never immediately.
    std::atomic<uint64_t>* callback_generation = nullptr;

    // Transport state (atomics for lock-free access)
    transport::TransportState* transport = nullptr;

    // Telemetry counters
    std::atomic<uint64_t>* buffer_underrun_count = nullptr;

    // Sample rate for calculations
    uint32_t sample_rate = 48000;

    // F5 : horloge de SESSION libre. Avance de frame_count a chaque callback,
    // meme transport a l'arret. Les slots lances s'y rebasent (independants de
    // la position d'arrangement). Touchee UNIQUEMENT par le thread audio (pas
    // d'atomic : un seul ecrivain/lecteur, le callback lui-meme).
    int64_t session_clock = 0;

    // A6 (piste A, mesure) : la FORME reelle des callbacks du driver -
    // min/max de frame_count et compte des callbacks NON multiples de
    // 256 (chaque queue partielle bypasse les plugins, proxy_node:13).
    // Ecrits par le callback (relaxed), lus par le control thread.
    std::atomic<uint32_t>* cb_min_frames = nullptr;
    std::atomic<uint32_t>* cb_max_frames = nullptr;
    std::atomic<uint64_t>* cb_partial_count = nullptr;
    std::atomic<uint64_t>* cb_total_count = nullptr;
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
