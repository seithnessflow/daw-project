// SPDX-License-Identifier: GPL-3.0-or-later
#include "sync_proxy_node.h"

#include <cstring>

namespace daw::host {

void SyncProxyNode::process(float* output, const float* input, uint32_t frame_count,
                            int64_t position_samples) noexcept {
    if (bypass_) {
        // Identity, zero latency, bridge untouched
        if (!input) {
            std::memset(output, 0, frame_count * 2 * sizeof(float));
        } else if (output != input) {
            std::memmove(output, input, frame_count * 2 * sizeof(float));
        }
        return;
    }
    if (failed_ || !bridge_ || frame_count > kRingBlockSize) {
        failed_ = true;
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return;
    }

    float in_l[kRingBlockSize], in_r[kRingBlockSize];
    float out_l[kRingBlockSize], out_r[kRingBlockSize];
    for (uint32_t i = 0; i < frame_count; ++i) {
        in_l[i] = input ? input[2 * i] : 0.0f;
        in_r[i] = input ? input[2 * i + 1] : 0.0f;
    }

    // v8 MIDI : emet les notes de CE bloc AVANT l'echange - le FIFO doit
    // etre rempli avant que processBlockSync ne publie input_seq (l'enfant
    // draine le MIDI en traitant ce bloc). Un instrument recoit ainsi ses
    // notes ; un effet a notes_ vide (rien n'est emis).
    if (!notes_.empty()) {
        emitBlockNotes(notes_, position_samples, frame_count,
                       [this](bool on, uint8_t pitch, uint8_t vel, uint32_t off) {
                           bridge_->sendMidiNote(on, pitch, vel, 0, off);
                       });
    }

    if (!bridge_->processBlockSync(in_l, in_r, out_l, out_r, frame_count)) {
        failed_ = true;
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return;
    }

    for (uint32_t i = 0; i < frame_count; ++i) {
        output[2 * i] = out_l[i];
        output[2 * i + 1] = out_r[i];
    }
}

}  // namespace daw::host
