// SPDX-License-Identifier: GPL-3.0-or-later
#include "delay_node.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace daw::graph {

DelayNode::DelayNode(std::string id, float time_ms, float feedback, float mix)
    : id_(std::move(id))
    , time_ms_(std::clamp(time_ms, 1.0f, kMaxDelayMs))
    , feedback_(std::clamp(feedback, 0.0f, 0.95f))
    , mix_(std::clamp(mix, 0.0f, 1.0f)) {
    delay_samples_.store(
        static_cast<uint32_t>(std::lround(
            double(time_ms_.load(std::memory_order_relaxed)) * sample_rate_ / 1000.0)),
        std::memory_order_relaxed);
}

void DelayNode::process(float* output, const float* input,
                        uint32_t frame_count,
                        int64_t /*position_samples*/) noexcept {
    if (line_frames_ == 0) {  // prepare() jamais appele : identite
        if (input && input != output) {
            std::memcpy(output, input, size_t(frame_count) * 2 * sizeof(float));
        }
        return;
    }
    const uint32_t d = (std::min)(delay_samples_.load(std::memory_order_acquire),
                                  line_frames_ - 1);
    const float fb = feedback_.load(std::memory_order_acquire);
    const float mix = mix_.load(std::memory_order_acquire);
    const float dry = 1.0f - mix;
    const float* src = input ? input : output;

    for (uint32_t i = 0; i < frame_count; ++i) {
        const uint32_t rd = (write_ + line_frames_ - d) % line_frames_;
        const float dl = line_[size_t(rd) * 2];
        const float dr = line_[size_t(rd) * 2 + 1];
        const float il = src[i * 2];
        const float ir = src[i * 2 + 1];
        // Ecrire AVANT de sortir : la ligne recoit entree + retour
        line_[size_t(write_) * 2] = il + dl * fb;
        line_[size_t(write_) * 2 + 1] = ir + dr * fb;
        write_ = (write_ + 1) % line_frames_;
        output[i * 2] = il * dry + dl * mix;
        output[i * 2 + 1] = ir * dry + dr * mix;
    }
}

bool DelayNode::setParameter(const std::string& name, float value) noexcept {
    if (name == "timeMs") {
        time_ms_.store(std::clamp(value, 1.0f, kMaxDelayMs), std::memory_order_relaxed);
        delay_samples_.store(
            static_cast<uint32_t>(std::lround(
                double(time_ms_.load(std::memory_order_relaxed)) * sample_rate_ / 1000.0)),
            std::memory_order_release);
    } else if (name == "feedback") {
        feedback_.store(std::clamp(value, 0.0f, 0.95f), std::memory_order_relaxed);
    } else if (name == "mix") {
        mix_.store(std::clamp(value, 0.0f, 1.0f), std::memory_order_relaxed);
    } else {
        return false;
    }
    return true;
}

float DelayNode::getParameter(const std::string& name) const noexcept {
    if (name == "timeMs") return time_ms_.load(std::memory_order_relaxed);
    if (name == "feedback") return feedback_.load(std::memory_order_relaxed);
    if (name == "mix") return mix_.load(std::memory_order_relaxed);
    return 0.0f;
}

void DelayNode::prepare(uint32_t sample_rate, uint32_t /*max_block_size*/) {
    sample_rate_ = sample_rate;
    line_frames_ = static_cast<uint32_t>(
        double(kMaxDelayMs) * sample_rate / 1000.0) + 1;
    line_.assign(size_t(line_frames_) * 2, 0.0f);  // controle : alloc OK ici
    write_ = 0;
    delay_samples_.store(
        static_cast<uint32_t>(std::lround(
            double(time_ms_.load(std::memory_order_relaxed)) * sample_rate / 1000.0)),
        std::memory_order_release);
}

void DelayNode::reset() noexcept {
    std::fill(line_.begin(), line_.end(), 0.0f);
    write_ = 0;
}

}  // namespace daw::graph
