// SPDX-License-Identifier: GPL-3.0-or-later
#include "drive_node.h"

#include <algorithm>
#include <cmath>

namespace daw::graph {

namespace {
constexpr double kPi = 3.14159265358979323846;
}

DriveNode::DriveNode(std::string id, float drive_db, float level_db, float mix)
    : id_(std::move(id))
    , drive_db_(std::clamp(drive_db, 0.0f, 36.0f))
    , level_db_(std::clamp(level_db, -24.0f, 6.0f))
    , mix_(std::clamp(mix, 0.0f, 1.0f)) {
    updateGains();
    // Prototype par defaut (48 kHz implicite) - prepare() recalcule
    prepare(48000, 256);
}

void DriveNode::updateGains() noexcept {
    pre_gain_.store(
        std::pow(10.0, drive_db_.load(std::memory_order_relaxed) / 20.0),
        std::memory_order_relaxed);
    post_gain_.store(
        std::pow(10.0, level_db_.load(std::memory_order_relaxed) / 20.0),
        std::memory_order_relaxed);
}

void DriveNode::process(float* output, const float* input,
                        uint32_t frame_count,
                        int64_t /*position_samples*/) noexcept {
    const double pre = pre_gain_.load(std::memory_order_relaxed);
    const double post = post_gain_.load(std::memory_order_relaxed);
    const float mix = mix_.load(std::memory_order_relaxed);
    const float dry = 1.0f - mix;
    const float* src = input ? input : output;

    constexpr uint32_t kPhaseTaps = kTaps / kOs;  // 16 taps par phase

    for (uint32_t i = 0; i < frame_count; ++i) {
        for (int c = 0; c < 2; ++c) {
            ChannelState& st = ch_[c];
            const double x = src[i * 2 + c];

            // 1. Pousser l'entree dans l'histoire (taux de base)
            st.in_hist[st.in_pos] = x;
            const uint32_t in_size = uint32_t(st.in_hist.size());

            // 2. Interpolation polyphase x4 + shaper + histoire 4x
            for (uint32_t ph = 0; ph < kOs; ++ph) {
                // y_os[n*4+ph] = somme_k fir[k*4+ph] * in[n-k], gain x4
                double acc = 0.0;
                for (uint32_t k = 0; k < kPhaseTaps; ++k) {
                    const uint32_t tap = k * kOs + ph;
                    const uint32_t idx =
                        (st.in_pos + in_size - k) % in_size;
                    acc += fir_[tap] * st.in_hist[idx];
                }
                const double shaped = std::tanh(pre * (acc * kOs));
                st.os_hist[st.os_pos] = shaped;
                st.os_pos = (st.os_pos + 1) % kTaps;
            }
            st.in_pos = (st.in_pos + 1) % in_size;

            // 3. Decimation : un point de sortie = FIR complet sur
            // l'histoire 4x (le dernier ecrit est os_pos-1)
            double acc = 0.0;
            uint32_t idx = (st.os_pos + kTaps - 1) % kTaps;
            for (uint32_t k = 0; k < kTaps; ++k) {
                acc += fir_[k] * st.os_hist[idx];
                idx = (idx + kTaps - 1) % kTaps;
            }
            const double wet = acc * post;
            output[i * 2 + c] =
                float(double(src[i * 2 + c]) * dry + wet * mix);
        }
    }
}

bool DriveNode::setParameter(const std::string& name, float value) noexcept {
    if (name == "driveDb") drive_db_.store(std::clamp(value, 0.0f, 36.0f), std::memory_order_relaxed);
    else if (name == "levelDb") level_db_.store(std::clamp(value, -24.0f, 6.0f), std::memory_order_relaxed);
    else if (name == "mix") mix_.store(std::clamp(value, 0.0f, 1.0f), std::memory_order_relaxed);
    else return false;
    updateGains();
    return true;
}

float DriveNode::getParameter(const std::string& name) const noexcept {
    if (name == "driveDb") return drive_db_.load(std::memory_order_relaxed);
    if (name == "levelDb") return level_db_.load(std::memory_order_relaxed);
    if (name == "mix") return mix_.load(std::memory_order_relaxed);
    return 0.0f;
}

void DriveNode::prepare(uint32_t /*sample_rate*/, uint32_t /*max_block_size*/) {
    // Prototype sinc fenetre Blackman, coupure 0.475*fs_base normalisee
    // au taux 4x (independant du fs absolu - tout est relatif ici)
    const double fc = 0.475 / double(kOs);  // cycles/echantillon au taux 4x
    const double center = double(kTaps - 1) / 2.0;
    double sum = 0.0;
    for (uint32_t n = 0; n < kTaps; ++n) {
        const double t = double(n) - center;
        const double sinc = t == 0.0
            ? 2.0 * fc
            : std::sin(2.0 * kPi * fc * t) / (kPi * t);
        const double w = 0.42 - 0.5 * std::cos(2.0 * kPi * n / (kTaps - 1)) +
                         0.08 * std::cos(4.0 * kPi * n / (kTaps - 1));
        fir_[n] = sinc * w;
        sum += fir_[n];
    }
    // Normaliser au gain DC unite
    for (auto& c : fir_) c /= sum;
    reset();
}

void DriveNode::reset() noexcept {
    for (auto& st : ch_) {
        st.in_hist.fill(0.0);
        st.os_hist.fill(0.0);
        st.in_pos = 0;
        st.os_pos = 0;
    }
}

}  // namespace daw::graph
