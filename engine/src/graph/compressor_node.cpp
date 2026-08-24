// SPDX-License-Identifier: GPL-3.0-or-later
#include "compressor_node.h"

#include <algorithm>
#include <cmath>

namespace daw::graph {

CompressorNode::CompressorNode(std::string id, float threshold_db,
                               float ratio, float attack_ms,
                               float release_ms, float makeup_db)
    : id_(std::move(id))
    , threshold_db_(std::clamp(threshold_db, -60.0f, 0.0f))
    , ratio_(std::clamp(ratio, 1.0f, 20.0f))
    , attack_ms_(std::clamp(attack_ms, 0.1f, 100.0f))
    , release_ms_(std::clamp(release_ms, 5.0f, 1000.0f))
    , makeup_db_(std::clamp(makeup_db, 0.0f, 24.0f)) {
    updateDerived();
}

void CompressorNode::updateDerived() noexcept {
    const double sr = sample_rate_;
    auto coeff = [&](double ms) {
        return 1.0 - std::exp(-1.0 / (sr * ms / 1000.0));
    };
    attack_coeff_.store(coeff(attack_ms_.load(std::memory_order_relaxed)),
                        std::memory_order_relaxed);
    release_coeff_.store(coeff(release_ms_.load(std::memory_order_relaxed)),
                         std::memory_order_relaxed);
    makeup_lin_.store(
        std::pow(10.0, makeup_db_.load(std::memory_order_relaxed) / 20.0),
        std::memory_order_relaxed);
    threshold_lin_.store(
        std::pow(10.0, threshold_db_.load(std::memory_order_relaxed) / 20.0),
        std::memory_order_relaxed);
    slope_.store(1.0 - 1.0 / ratio_.load(std::memory_order_relaxed),
                 std::memory_order_relaxed);
}

void CompressorNode::process(float* output, const float* input,
                             uint32_t frame_count,
                             int64_t /*position_samples*/) noexcept {
    const double atk = attack_coeff_.load(std::memory_order_relaxed);
    const double rel = release_coeff_.load(std::memory_order_relaxed);
    const double makeup = makeup_lin_.load(std::memory_order_relaxed);
    const double thr = threshold_lin_.load(std::memory_order_relaxed);
    const double slope = slope_.load(std::memory_order_relaxed);
    const float* src = input ? input : output;

    for (uint32_t i = 0; i < frame_count; ++i) {
        const double l = src[i * 2];
        const double r = src[i * 2 + 1];
        const double peak = std::max(std::abs(l), std::abs(r));
        // Detecteur : attaque quand ca monte, release quand ca descend
        const double c = peak > envelope_ ? atk : rel;
        envelope_ += c * (peak - envelope_);
        // Gain : au-dessus du seuil, reduction = over_dB * slope
        double gain = 1.0;
        if (envelope_ > thr) {
            const double over_db = 20.0 * std::log10(envelope_ / thr);
            gain = std::pow(10.0, -(over_db * slope) / 20.0);
        }
        const double g = gain * makeup;
        output[i * 2] = static_cast<float>(l * g);
        output[i * 2 + 1] = static_cast<float>(r * g);
    }
}

bool CompressorNode::setParameter(const std::string& name, float value) noexcept {
    if (name == "thresholdDb") threshold_db_.store(std::clamp(value, -60.0f, 0.0f), std::memory_order_relaxed);
    else if (name == "ratio") ratio_.store(std::clamp(value, 1.0f, 20.0f), std::memory_order_relaxed);
    else if (name == "attackMs") attack_ms_.store(std::clamp(value, 0.1f, 100.0f), std::memory_order_relaxed);
    else if (name == "releaseMs") release_ms_.store(std::clamp(value, 5.0f, 1000.0f), std::memory_order_relaxed);
    else if (name == "makeupDb") makeup_db_.store(std::clamp(value, 0.0f, 24.0f), std::memory_order_relaxed);
    else return false;
    updateDerived();
    return true;
}

float CompressorNode::getParameter(const std::string& name) const noexcept {
    if (name == "thresholdDb") return threshold_db_.load(std::memory_order_relaxed);
    if (name == "ratio") return ratio_.load(std::memory_order_relaxed);
    if (name == "attackMs") return attack_ms_.load(std::memory_order_relaxed);
    if (name == "releaseMs") return release_ms_.load(std::memory_order_relaxed);
    if (name == "makeupDb") return makeup_db_.load(std::memory_order_relaxed);
    return 0.0f;
}

void CompressorNode::prepare(uint32_t sample_rate, uint32_t /*max_block_size*/) {
    sample_rate_ = sample_rate;
    updateDerived();
}

void CompressorNode::reset() noexcept {
    envelope_ = 0.0;
}

}  // namespace daw::graph
