// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file shared_audio_ring.h
 * @brief The shared-memory segment between engine and plugin host (ADR-017).
 *
 * THIS LAYOUT IS A BINARY CONTRACT BETWEEN TWO EXECUTABLES compiled
 * separately: engine and plugin_host both include this exact header, and
 * the static_asserts below (sizeof + offsetof on every field) turn any
 * silent padding/ordering divergence into a compile error. This is the
 * SCHEMA.md of the binary world - bump kLayoutVersion on ANY change.
 *
 * Concurrency rules (same guarantee family as the sacred thread, new
 * boundary):
 * - Every synchronization field is a std::atomic that MUST be lock-free
 *   (asserted below): std::atomic works across processes only if it lives
 *   physically in the shared segment and is address-free/lock-free.
 * - NO STL mutex ever goes in this segment (a kernel object is not a
 *   memory object; an STL mutex in shared memory is undefined behavior in
 *   a trench coat). Sequence-published double buffers only - the peaks
 *   mold, across a process boundary.
 *
 * Pipelined exchange (decided in TODO 2.4c-1, DEPTH REVISED the same day):
 * the engine deposits block N and collects block N-depth. The original
 * one-frame depth assumed a regular block cadence; reality (first live
 * run, 534/1875 blocks missed): the driver delivers bursts of
 * buffer_size/256 blocks back-to-back microseconds apart, so the child
 * must be given a full DEVICE PERIOD, not a block period. Depth is a
 * NODE-SIDE POLICY (= blocks per device callback, 2 for the 512 default),
 * the layout only provides enough slots (kRingSlots=4 covers depth<=2
 * with write/read separation). Cost: depth blocks of latency, declared
 * via getLatencySamples() in 2.4d. A missing block is NEVER waited for on
 * the audio thread: bypass + incident counter. Child death is detected by
 * the CONTROL thread via the process handle - the callback only knows
 * "block ready or not".
 */

#include <atomic>
#include <cstddef>
#include <cstdint>

namespace daw::host {

inline constexpr uint32_t kRingMagic = 0x52574144;  // 'DAWR'
inline constexpr uint32_t kLayoutVersion = 8;       // v8: MIDI event FIFO (v7: plugin_latency_samples)
inline constexpr uint32_t kParamQueueSlots = 64;    // power of two
inline constexpr uint32_t kMidiQueueSlots = 256;    // power of two; note events per block, drained by the child
inline constexpr uint32_t kRingBlockSize = 256;     // == audio::INTERNAL_BLOCK_SIZE
inline constexpr uint32_t kRingChannels = 2;
inline constexpr uint32_t kRingSlots = 4;           // power of two; covers depth <= 2

struct SharedAudioRing {
    // ---- Contract header (plain, written once by the engine) ----
    uint32_t magic;
    uint32_t layout_version;
    uint32_t block_size;
    uint32_t sample_rate;

    // ---- Sequencing (block numbers start at 1; 0 = nothing yet) ----
    // Engine: publishes after writing input slot (seq % kRingSlots)
    std::atomic<uint64_t> input_seq;
    // Child: publishes after writing the matching output slot
    std::atomic<uint64_t> output_seq;

    // ---- Parameter channel (v5): SPSC FIFO ---------------------------------
    // The v3/v4 single seqlock SLOT lost every param but the last of a
    // burst (one read per block, latest-wins) - invisible with AGain's
    // single param, immediate with any REAL multi-param plugin (mda):
    // a rebuild re-sends the document's params back-to-back and N-1
    // vanished. Now a FIFO: single writer (control thread) pushes
    // {id, value} pairs; single reader (child) DRAINS everything
    // pending into one block's IParameterChanges.
    //   writer: if full, overwrite the OLDEST (advance read_idx) - a
    //   64-deep burst degrades to latest-wins per id, never a stall
    //   on the control thread.
    //   reader: while read_idx != write_idx (acquire), read pair at
    //   read_idx, then advance read_idx (release).
    // Slot fields are plain (not atomic): the indices order them - a
    // slot is only read after write_idx is published past it.
    std::atomic<uint64_t> param_write_idx;
    std::atomic<uint64_t> param_read_idx;
    uint32_t param_ids[kParamQueueSlots];
    double param_values[kParamQueueSlots];

    // ---- Lifecycle ----
    std::atomic<uint32_t> shutdown;     // engine sets 1; child exits cleanly
    std::atomic<uint64_t> child_heartbeat;  // child bumps per processed block

    // ---- State side-channel (2.5-etat, v4) ----
    // The BLOB never crosses the ring: it travels through the file
    // `<segment>.state` next to the segment. These two sequences only
    // coordinate WHO wrote it last:
    //   save:    engine bumps state_request_seq; the child serializes
    //            IComponent state to the file, then copies the request
    //            into state_ready_seq. Engine waits (bounded, control
    //            thread) for ready >= its request, then reads the file.
    //   restore: the engine writes the file BEFORE spawn/restart; the
    //            child loads it during its ceremony (processor-first),
    //            before the heartbeat says ready.
    std::atomic<uint64_t> state_request_seq;
    std::atomic<uint64_t> state_ready_seq;

    // ---- Edits GUI (fenetrage v1, v6) ----
    // L'enfant bump quand des performEdit de la fenetre ont ete pousses
    // dans le COMPOSANT (drain au bloc suivant, ou flush numSamples==0 a
    // l'arret). Le moteur le sonde au rythme telemetrie et programme la
    // capture d'etat debouncee : un reglage a la fenetre SURVIT (blob au
    // store, hash au document) et VOYAGE (cle de stem -> les pairs
    // re-entendent le reglage sans avoir le plugin).
    std::atomic<uint64_t> gui_edit_seq;

    // ---- PDC ecrivain (session 3, v7) ----
    // La latence INTERNE declaree par le plugin (IAudioProcessor::
    // getLatencySamples), ecrite par l'enfant apres sa ceremonie et a
    // chaque kLatencyChanged futur. Le rendu de stem la SOMME sur la
    // chaine et la declare au document (stemLatencySamples) - le
    // lecteur (graph_common, gteste) avance le stem d'autant. AGain et
    // les plugins sans lookahead ecrivent 0 : le flux est le meme.
    // uint64 pour garder les offsets multiples de 8 (pas de padding).
    std::atomic<uint64_t> plugin_latency_samples;

    // ---- MIDI event channel (v8): SPSC FIFO, meme moule que les params ----
    // L'ENGINE (thread de controle) pousse les evenements de note du bloc ;
    // l'ENFANT les DRAINE dans l'IEventList VST3 avant process(). Meme
    // discipline d'indices que le FIFO param (slots plain, ordonnes par les
    // index). Les notes sont TRANSITOIRES : jamais rejouees a un cold restart
    // (contrairement aux params) - un restart envoie un all-notes-off. Plein
    // = on ecrase la plus VIEILLE (avance read_idx), le controle ne stalle
    // jamais (un debordement > 256 notes/bloc n'est jamais legitime).
    std::atomic<uint64_t> midi_write_idx;
    std::atomic<uint64_t> midi_read_idx;
    uint8_t  midi_type[kMidiQueueSlots];      // 0 = note-off, 1 = note-on
    uint8_t  midi_pitch[kMidiQueueSlots];     // 0..127
    uint8_t  midi_velocity[kMidiQueueSlots];  // 0..127
    uint8_t  midi_channel[kMidiQueueSlots];   // 0..15
    uint32_t midi_offset[kMidiQueueSlots];    // offset en samples DANS le bloc

    // ---- Planar audio, double-buffered: [slot][channel][frame] ----
    float in[kRingSlots][kRingChannels][kRingBlockSize];
    float out[kRingSlots][kRingChannels][kRingBlockSize];
};

// ---- The binary contract, compiler-enforced --------------------------------
static_assert(std::is_standard_layout_v<SharedAudioRing>,
              "shared segment must be standard layout");
static_assert(std::atomic<uint64_t>::is_always_lock_free &&
              std::atomic<uint32_t>::is_always_lock_free &&
              std::atomic<double>::is_always_lock_free,
              "cross-process atomics must be lock-free (address-free)");
static_assert(offsetof(SharedAudioRing, magic) == 0);
static_assert(offsetof(SharedAudioRing, layout_version) == 4);
static_assert(offsetof(SharedAudioRing, block_size) == 8);
static_assert(offsetof(SharedAudioRing, sample_rate) == 12);
static_assert(offsetof(SharedAudioRing, input_seq) == 16);
static_assert(offsetof(SharedAudioRing, output_seq) == 24);
static_assert(offsetof(SharedAudioRing, param_write_idx) == 32);
static_assert(offsetof(SharedAudioRing, param_read_idx) == 40);
static_assert(offsetof(SharedAudioRing, param_ids) == 48);
static_assert(offsetof(SharedAudioRing, param_values) == 48 + kParamQueueSlots * 4);
static_assert(offsetof(SharedAudioRing, shutdown) == 48 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, child_heartbeat) == 56 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, state_request_seq) == 64 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, state_ready_seq) == 72 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, gui_edit_seq) == 80 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, plugin_latency_samples) == 88 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, midi_write_idx) == 96 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, midi_read_idx) == 104 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, midi_type) == 112 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, midi_pitch) == 112 + kParamQueueSlots * 12 + kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, midi_velocity) == 112 + kParamQueueSlots * 12 + 2 * kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, midi_channel) == 112 + kParamQueueSlots * 12 + 3 * kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, midi_offset) == 112 + kParamQueueSlots * 12 + 4 * kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, in) == 112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, out) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  kRingSlots * kRingChannels * kRingBlockSize * 4);
static_assert(sizeof(SharedAudioRing) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  2 * (kRingSlots * kRingChannels * kRingBlockSize * 4),
              "layout drifted - bump kLayoutVersion and fix BOTH sides");

// Ecrit UN evenement de note dans le FIFO MIDI (SPSC, single writer). Utilise
// par PluginBridge (offline, thread de controle) ET ProxyNode (live, thread
// audio) - JAMAIS les deux sur le meme ring simultanement (regle
// un-producteur-par-ring, cf. proxy_node.h). RT-safe : que des atomics et des
// ecritures de slots plain, aucune alloc/syscall. Plein = ecrase la plus
// vieille (avance read_idx), l'ecrivain ne stalle jamais.
inline void pushMidiEvent(SharedAudioRing* ring, bool note_on, uint8_t pitch,
                          uint8_t velocity, uint8_t channel,
                          uint32_t sample_offset) noexcept {
    const uint64_t w = ring->midi_write_idx.load(std::memory_order_relaxed);
    uint64_t r = ring->midi_read_idx.load(std::memory_order_acquire);
    if (w - r >= kMidiQueueSlots) {
        ring->midi_read_idx.compare_exchange_strong(r, r + 1,
                                                    std::memory_order_acq_rel);
    }
    const uint32_t slot = static_cast<uint32_t>(w % kMidiQueueSlots);
    ring->midi_type[slot] = note_on ? 1 : 0;
    ring->midi_pitch[slot] = pitch;
    ring->midi_velocity[slot] = velocity;
    ring->midi_channel[slot] = channel;
    ring->midi_offset[slot] = sample_offset;
    ring->midi_write_idx.store(w + 1, std::memory_order_release);
}

}  // namespace daw::host
