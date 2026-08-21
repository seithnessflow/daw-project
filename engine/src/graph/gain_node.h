// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file gain_node.h
 * @brief Simple gain processor (builtin.gain).
 */

#include "processor_node.h"

#include <atomic>
#include <string>

namespace daw::graph {

/**
 * Simple gain processor.
 *
 * Applies a linear gain multiplier to the audio signal.
 * Uses atomic float for lock-free parameter updates.
 */
class GainNode : public ProcessorNode {
public:
    static constexpr const char* TYPE = "builtin.gain";
    static constexpr const char* PARAM_GAIN = "gain";

    /**
     * Construct a gain node.
     *
     * @param id Unique instance ID
     * @param initial_gain Initial gain value (linear, 0.0 to 2.0)
     */
    explicit GainNode(std::string id, float initial_gain = 1.0f);

    // ProcessorNode interface
    void process(
        float* output,
        const float* input,
        uint32_t frame_count,
        int64_t position_samples
    ) noexcept override;

    [[nodiscard]] const std::string& getType() const noexcept override {
        return type_;
    }

    [[nodiscard]] const std::string& getId() const noexcept override {
        return id_;
    }

    bool setParameter(const std::string& name, float value) noexcept override;
    [[nodiscard]] float getParameter(const std::string& name) const noexcept override;

    void prepare(uint32_t sample_rate, uint32_t max_block_size) override;
    void reset() noexcept override;

    // Direct gain access (for convenience)
    void setGain(float gain) noexcept {
        gain_.store(gain, std::memory_order_release);
    }

    [[nodiscard]] float getGain() const noexcept {
        return gain_.load(std::memory_order_acquire);
    }

private:
    std::string id_;
    std::string type_{TYPE};
    std::atomic<float> gain_;

    // Smoothing state to prevent clicks on gain changes
    float smoothed_gain_ = 1.0f;
    float smooth_coeff_ = 0.0f;
    uint32_t sample_rate_ = 48000;
};

}  // namespace daw::graph
