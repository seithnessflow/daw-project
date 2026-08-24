// SPDX-License-Identifier: GPL-3.0-or-later
#include "utility_node.h"

#include <algorithm>
#include <cmath>

namespace daw::graph {

UtilityNode::UtilityNode(std::string id, float gain, float pan, bool mono,
                         bool phase)
    : id_(std::move(id))
    , gain_(std::clamp(gain, 0.0f, 2.0f))
    , pan_(std::clamp(pan, -1.0f, 1.0f))
    , mono_(mono)
    , phase_(phase) {
    updateMatrix();
    // Le lisseur demarre SUR la cible : un graphe fraichement construit
    // multiplie par des constantes - determinisme du rendu offline
    s_ll_ = t_ll_.load(std::memory_order_relaxed);
    s_lr_ = t_lr_.load(std::memory_order_relaxed);
    s_rl_ = t_rl_.load(std::memory_order_relaxed);
    s_rr_ = t_rr_.load(std::memory_order_relaxed);
}

void UtilityNode::updateMatrix() noexcept {
    const float g = gain_.load(std::memory_order_relaxed) *
                    (phase_.load(std::memory_order_relaxed) ? -1.0f : 1.0f);
    const float pan = pan_.load(std::memory_order_relaxed);
    // Balance a centre UNITE
    const float bl = pan <= 0.0f ? 1.0f : 1.0f - pan;
    const float br = pan >= 0.0f ? 1.0f : 1.0f + pan;
    if (mono_.load(std::memory_order_relaxed)) {
        // Somme mono equilibree PUIS balance : chaque sortie recoit
        // (L+R)/2 ponderee par son cote
        t_ll_.store(0.5f * g * bl, std::memory_order_relaxed);
        t_lr_.store(0.5f * g * bl, std::memory_order_relaxed);
        t_rl_.store(0.5f * g * br, std::memory_order_relaxed);
        t_rr_.store(0.5f * g * br, std::memory_order_relaxed);
    } else {
        t_ll_.store(g * bl, std::memory_order_relaxed);
        t_lr_.store(0.0f, std::memory_order_relaxed);
        t_rl_.store(0.0f, std::memory_order_relaxed);
        t_rr_.store(g * br, std::memory_order_relaxed);
    }
}

void UtilityNode::process(float* output, const float* input,
                          uint32_t frame_count,
                          int64_t /*position_samples*/) noexcept {
    const float ll = t_ll_.load(std::memory_order_acquire);
    const float lr = t_lr_.load(std::memory_order_acquire);
    const float rl = t_rl_.load(std::memory_order_acquire);
    const float rr = t_rr_.load(std::memory_order_acquire);
    const float* src = input ? input : output;
    for (uint32_t i = 0; i < frame_count; ++i) {
        s_ll_ += smooth_coeff_ * (ll - s_ll_);
        s_lr_ += smooth_coeff_ * (lr - s_lr_);
        s_rl_ += smooth_coeff_ * (rl - s_rl_);
        s_rr_ += smooth_coeff_ * (rr - s_rr_);
        const float l = src[i * 2];
        const float r = src[i * 2 + 1];
        output[i * 2] = l * s_ll_ + r * s_lr_;
        output[i * 2 + 1] = l * s_rl_ + r * s_rr_;
    }
}

bool UtilityNode::setParameter(const std::string& name, float value) noexcept {
    if (name == PARAM_GAIN) {
        gain_.store(std::clamp(value, 0.0f, 2.0f), std::memory_order_relaxed);
    } else if (name == PARAM_PAN) {
        pan_.store(std::clamp(value, -1.0f, 1.0f), std::memory_order_relaxed);
    } else if (name == PARAM_MONO) {
        mono_.store(value >= 0.5f, std::memory_order_relaxed);
    } else if (name == PARAM_PHASE) {
        phase_.store(value >= 0.5f, std::memory_order_relaxed);
    } else {
        return false;
    }
    updateMatrix();
    return true;
}

float UtilityNode::getParameter(const std::string& name) const noexcept {
    if (name == PARAM_GAIN) return gain_.load(std::memory_order_relaxed);
    if (name == PARAM_PAN) return pan_.load(std::memory_order_relaxed);
    if (name == PARAM_MONO) return mono_.load(std::memory_order_relaxed) ? 1.0f : 0.0f;
    if (name == PARAM_PHASE) return phase_.load(std::memory_order_relaxed) ? 1.0f : 0.0f;
    return 0.0f;
}

void UtilityNode::prepare(uint32_t sample_rate, uint32_t /*max_block_size*/) {
    // Meme moule que GainNode : ~5 ms vers la cible
    const float samples_to_target = sample_rate * 5.0f / 1000.0f;
    smooth_coeff_ = 1.0f - std::exp(-1.0f / samples_to_target);
}

void UtilityNode::reset() noexcept {
    s_ll_ = t_ll_.load(std::memory_order_relaxed);
    s_lr_ = t_lr_.load(std::memory_order_relaxed);
    s_rl_ = t_rl_.load(std::memory_order_relaxed);
    s_rr_ = t_rr_.load(std::memory_order_relaxed);
}

}  // namespace daw::graph
