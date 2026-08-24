// SPDX-License-Identifier: GPL-3.0-or-later
#include "eq3_node.h"

#include <algorithm>
#include <cmath>

namespace daw::graph {

namespace {
constexpr double kPi = 3.14159265358979323846;

struct RbjOut {
    double b0, b1, b2, a1, a2;  // normalises par a0
};

// RBJ Audio EQ Cookbook - shelves avec S=1, peaking avec Q donne
RbjOut lowShelf(double sr, double f, double gain_db) {
    const double A = std::pow(10.0, gain_db / 40.0);
    const double w = 2.0 * kPi * f / sr;
    const double cw = std::cos(w), sw = std::sin(w);
    const double alpha = sw / 2.0 * std::sqrt(2.0);  // S = 1
    const double sq = 2.0 * std::sqrt(A) * alpha;
    const double a0 = (A + 1) + (A - 1) * cw + sq;
    return {
        (A * ((A + 1) - (A - 1) * cw + sq)) / a0,
        (2 * A * ((A - 1) - (A + 1) * cw)) / a0,
        (A * ((A + 1) - (A - 1) * cw - sq)) / a0,
        (-2 * ((A - 1) + (A + 1) * cw)) / a0,
        ((A + 1) + (A - 1) * cw - sq) / a0,
    };
}

RbjOut highShelf(double sr, double f, double gain_db) {
    const double A = std::pow(10.0, gain_db / 40.0);
    const double w = 2.0 * kPi * f / sr;
    const double cw = std::cos(w), sw = std::sin(w);
    const double alpha = sw / 2.0 * std::sqrt(2.0);  // S = 1
    const double sq = 2.0 * std::sqrt(A) * alpha;
    const double a0 = (A + 1) - (A - 1) * cw + sq;
    return {
        (A * ((A + 1) + (A - 1) * cw + sq)) / a0,
        (-2 * A * ((A - 1) + (A + 1) * cw)) / a0,
        (A * ((A + 1) + (A - 1) * cw - sq)) / a0,
        (2 * ((A - 1) - (A + 1) * cw)) / a0,
        ((A + 1) - (A - 1) * cw - sq) / a0,
    };
}

RbjOut peaking(double sr, double f, double gain_db, double q) {
    const double A = std::pow(10.0, gain_db / 40.0);
    const double w = 2.0 * kPi * f / sr;
    const double cw = std::cos(w), sw = std::sin(w);
    const double alpha = sw / (2.0 * q);
    const double a0 = 1 + alpha / A;
    return {
        (1 + alpha * A) / a0,
        (-2 * cw) / a0,
        (1 - alpha * A) / a0,
        (-2 * cw) / a0,
        (1 - alpha / A) / a0,
    };
}
}  // namespace

Eq3Node::Eq3Node(std::string id, float low_gain_db, float low_freq,
                 float peak_gain_db, float peak_freq, float peak_q,
                 float high_gain_db, float high_freq)
    : id_(std::move(id))
    , low_gain_db_(std::clamp(low_gain_db, -15.0f, 15.0f))
    , low_freq_(std::clamp(low_freq, 20.0f, 500.0f))
    , peak_gain_db_(std::clamp(peak_gain_db, -15.0f, 15.0f))
    , peak_freq_(std::clamp(peak_freq, 100.0f, 8000.0f))
    , peak_q_(std::clamp(peak_q, 0.3f, 4.0f))
    , high_gain_db_(std::clamp(high_gain_db, -15.0f, 15.0f))
    , high_freq_(std::clamp(high_freq, 1000.0f, 16000.0f)) {
    updateCoeffs();
}

void Eq3Node::updateCoeffs() noexcept {
    const double sr = sample_rate_;
    auto pub = [](Coeffs& c, const RbjOut& o) {
        c.b0.store(o.b0, std::memory_order_relaxed);
        c.b1.store(o.b1, std::memory_order_relaxed);
        c.b2.store(o.b2, std::memory_order_relaxed);
        c.a1.store(o.a1, std::memory_order_relaxed);
        c.a2.store(o.a2, std::memory_order_relaxed);
    };
    pub(low_, lowShelf(sr, low_freq_.load(std::memory_order_relaxed),
                       low_gain_db_.load(std::memory_order_relaxed)));
    pub(peak_, peaking(sr, peak_freq_.load(std::memory_order_relaxed),
                       peak_gain_db_.load(std::memory_order_relaxed),
                       peak_q_.load(std::memory_order_relaxed)));
    pub(high_, highShelf(sr, high_freq_.load(std::memory_order_relaxed),
                         high_gain_db_.load(std::memory_order_relaxed)));
}

void Eq3Node::process(float* output, const float* input,
                      uint32_t frame_count,
                      int64_t /*position_samples*/) noexcept {
    struct Local { double b0, b1, b2, a1, a2; };
    auto grab = [](const Coeffs& c) {
        return Local{c.b0.load(std::memory_order_relaxed),
                     c.b1.load(std::memory_order_relaxed),
                     c.b2.load(std::memory_order_relaxed),
                     c.a1.load(std::memory_order_relaxed),
                     c.a2.load(std::memory_order_relaxed)};
    };
    const Local lo = grab(low_), pk = grab(peak_), hi = grab(high_);
    const float* src = input ? input : output;

    auto biquad = [](const Local& c, State& s, double x) {
        // DF2T : y = b0*x + z1 ; z1 = b1*x - a1*y + z2 ; z2 = b2*x - a2*y
        const double y = c.b0 * x + s.z1;
        s.z1 = c.b1 * x - c.a1 * y + s.z2;
        s.z2 = c.b2 * x - c.a2 * y;
        return y;
    };

    for (uint32_t i = 0; i < frame_count; ++i) {
        for (int ch = 0; ch < 2; ++ch) {
            double x = src[i * 2 + ch];
            x = biquad(lo, s_low_[ch], x);
            x = biquad(pk, s_peak_[ch], x);
            x = biquad(hi, s_high_[ch], x);
            output[i * 2 + ch] = static_cast<float>(x);
        }
    }
}

bool Eq3Node::setParameter(const std::string& name, float value) noexcept {
    if (name == "lowGainDb") low_gain_db_.store(std::clamp(value, -15.0f, 15.0f), std::memory_order_relaxed);
    else if (name == "lowFreq") low_freq_.store(std::clamp(value, 20.0f, 500.0f), std::memory_order_relaxed);
    else if (name == "peakGainDb") peak_gain_db_.store(std::clamp(value, -15.0f, 15.0f), std::memory_order_relaxed);
    else if (name == "peakFreq") peak_freq_.store(std::clamp(value, 100.0f, 8000.0f), std::memory_order_relaxed);
    else if (name == "peakQ") peak_q_.store(std::clamp(value, 0.3f, 4.0f), std::memory_order_relaxed);
    else if (name == "highGainDb") high_gain_db_.store(std::clamp(value, -15.0f, 15.0f), std::memory_order_relaxed);
    else if (name == "highFreq") high_freq_.store(std::clamp(value, 1000.0f, 16000.0f), std::memory_order_relaxed);
    else return false;
    updateCoeffs();
    return true;
}

float Eq3Node::getParameter(const std::string& name) const noexcept {
    if (name == "lowGainDb") return low_gain_db_.load(std::memory_order_relaxed);
    if (name == "lowFreq") return low_freq_.load(std::memory_order_relaxed);
    if (name == "peakGainDb") return peak_gain_db_.load(std::memory_order_relaxed);
    if (name == "peakFreq") return peak_freq_.load(std::memory_order_relaxed);
    if (name == "peakQ") return peak_q_.load(std::memory_order_relaxed);
    if (name == "highGainDb") return high_gain_db_.load(std::memory_order_relaxed);
    if (name == "highFreq") return high_freq_.load(std::memory_order_relaxed);
    return 0.0f;
}

void Eq3Node::prepare(uint32_t sample_rate, uint32_t /*max_block_size*/) {
    sample_rate_ = sample_rate;
    updateCoeffs();
}

void Eq3Node::reset() noexcept {
    for (int ch = 0; ch < 2; ++ch) {
        s_low_[ch] = {};
        s_peak_[ch] = {};
        s_high_[ch] = {};
    }
}

}  // namespace daw::graph
