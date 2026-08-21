// SPDX-License-Identifier: GPL-3.0-or-later
#include "gain_node.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace daw::graph {

GainNode::GainNode(std::string id, float initial_gain)
    : id_(std::move(id))
    , gain_(std::clamp(initial_gain, 0.0f, 2.0f))
    , smoothed_gain_(initial_gain)
{
}

void GainNode::process(
    float* output,
    const float* input,
    uint32_t frame_count,
    int64_t /*position_samples*/
) noexcept {
    // Get target gain atomically
    const float target_gain = gain_.load(std::memory_order_acquire);

    // If no input, assume in-place processing (output already has data)
    const float* src = input ? input : output;

    // Process with smoothing to prevent clicks
    for (uint32_t i = 0; i < frame_count; ++i) {
        // One-pole smoother
        smoothed_gain_ += smooth_coeff_ * (target_gain - smoothed_gain_);

        // Apply gain to both channels (interleaved stereo)
        output[i * 2]     = src[i * 2]     * smoothed_gain_;
        output[i * 2 + 1] = src[i * 2 + 1] * smoothed_gain_;
    }
}

bool GainNode::setParameter(const std::string& name, float value) noexcept {
    if (name == PARAM_GAIN) {
        setGain(std::clamp(value, 0.0f, 2.0f));
        return true;
    }
    return false;
}

float GainNode::getParameter(const std::string& name) const noexcept {
    if (name == PARAM_GAIN) {
        return getGain();
    }
    return 0.0f;
}

void GainNode::prepare(uint32_t sample_rate, uint32_t /*max_block_size*/) {
    sample_rate_ = sample_rate;

    // Calculate smoothing coefficient for ~5ms smoothing time
    // This prevents clicks when gain changes abruptly
    const float smoothing_time_ms = 5.0f;
    const float samples_to_target = sample_rate * smoothing_time_ms / 1000.0f;
    smooth_coeff_ = 1.0f - std::exp(-1.0f / samples_to_target);
}

void GainNode::reset() noexcept {
    smoothed_gain_ = gain_.load(std::memory_order_acquire);
}

}  // namespace daw::graph
