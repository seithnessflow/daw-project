// SPDX-License-Identifier: GPL-3.0-or-later
#include "proxy_node.h"

#include <cstring>

namespace daw::host {

void ProxyNode::process(float* output, const float* input, uint32_t frame_count,
                        int64_t position_samples) noexcept {
    // Contract breach (no ring, or a partial tail block the fixed-size ring
    // cannot carry): dry pass-through, counted. The live callback always
    // cuts 256-frame chunks, so this fires only on misuse.
    if (!ring_ || frame_count != kRingBlockSize) {
        if (!input) {
            std::memset(output, 0, frame_count * 2 * sizeof(float));
        } else if (output != input) {
            std::memmove(output, input, frame_count * 2 * sizeof(float));
        }
        if (missed_) missed_->fetch_add(1, std::memory_order_relaxed);
        return;
    }

    // Deposit block N first: input may alias output (the chain runs in
    // place), so the ring must hold the input before output is written.
    const uint64_t seq = ring_->input_seq.load(std::memory_order_relaxed) + 1;
    const uint32_t slot = static_cast<uint32_t>(seq % kRingSlots);
    float* const in_l = ring_->in[slot][0];
    float* const in_r = ring_->in[slot][1];
    if (input) {
        for (uint32_t i = 0; i < kRingBlockSize; ++i) {
            in_l[i] = input[2 * i];
            in_r[i] = input[2 * i + 1];
        }
    } else {
        std::memset(in_l, 0, kRingBlockSize * sizeof(float));
        std::memset(in_r, 0, kRingBlockSize * sizeof(float));
    }
    // v8 MIDI : emet les notes de ce bloc dans le ring AVANT de publier
    // input_seq (l'enfant draine le MIDI en traitant ce bloc). RT-safe :
    // que des atomics + slots plain. Un effet a notes_ vide (rien n'est emis).
    if (!notes_.empty()) {
        emitBlockNotes(notes_, position_samples, kRingBlockSize,
                       [this](bool on, uint8_t pitch, uint8_t vel, uint32_t off) {
                           pushMidiEvent(ring_, on, pitch, vel, 0, off);
                       });
    }
    ring_->input_seq.store(seq, std::memory_order_release);

    // Return block N-depth
    if (seq <= depth_) {
        // Pipeline fill: the latency showing, not an incident
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return;
    }
    const uint64_t want = seq - depth_;
    const uint32_t wslot = static_cast<uint32_t>(want % kRingSlots);
    if (bypass_) {
        // Document-driven bypass: DRY block N-depth, same latency as wet -
        // the un-bypass swap changes the sound, never the timing. Not an
        // incident: no count.
        const float* const dry_l = ring_->in[wslot][0];
        const float* const dry_r = ring_->in[wslot][1];
        for (uint32_t i = 0; i < kRingBlockSize; ++i) {
            output[2 * i] = dry_l[i];
            output[2 * i + 1] = dry_r[i];
        }
        return;
    }
    if (ring_->output_seq.load(std::memory_order_acquire) >= want) {
        const float* const out_l = ring_->out[wslot][0];
        const float* const out_r = ring_->out[wslot][1];
        for (uint32_t i = 0; i < kRingBlockSize; ++i) {
            output[2 * i] = out_l[i];
            output[2 * i + 1] = out_r[i];
        }
    } else {
        // Child late (or dead - the control thread's business): DRY bypass
        // of the same block N-1, time-aligned, counted. Never wait.
        const float* const dry_l = ring_->in[wslot][0];
        const float* const dry_r = ring_->in[wslot][1];
        for (uint32_t i = 0; i < kRingBlockSize; ++i) {
            output[2 * i] = dry_l[i];
            output[2 * i + 1] = dry_r[i];
        }
        if (missed_) missed_->fetch_add(1, std::memory_order_relaxed);
    }
}

}  // namespace daw::host
