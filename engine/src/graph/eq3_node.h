// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file eq3_node.h
 * @brief EQ 3 bandes (builtin.eq3) - low shelf, peak parametrique,
 * high shelf (session 4.2).
 *
 * Biquads RBJ (Audio EQ Cookbook - litterature d'implementation, pas
 * de manuel produit) : les COEFFICIENTS sont recalcules HORS du
 * callback (prepare / setParameter, thread de controle) et publies en
 * atomic<double> ; l'ETAT des filtres (DF2T) vit en double sur le
 * thread audio seulement. Rien n'alloue, ne verrouille ni ne logge
 * dans process(). Latence : zero. Deterministe : memes entrees +
 * memes params = memes octets (etat initial nul, coefficients purs).
 *
 * Params (unites VRAIES, jamais de 0-1 nu) :
 *   lowGainDb  [-15..+15] dB   lowFreq  [20..500] Hz (shelf)
 *   peakGainDb [-15..+15] dB   peakFreq [100..8000] Hz   peakQ [0.3..4]
 *   highGainDb [-15..+15] dB   highFreq [1000..16000] Hz (shelf)
 */

#include "processor_node.h"

#include <atomic>
#include <string>

namespace daw::graph {

class Eq3Node : public ProcessorNode {
public:
    static constexpr const char* TYPE = "builtin.eq3";

    Eq3Node(std::string id, float low_gain_db, float low_freq,
            float peak_gain_db, float peak_freq, float peak_q,
            float high_gain_db, float high_freq);

    void process(float* output, const float* input, uint32_t frame_count,
                 int64_t position_samples) noexcept override;

    [[nodiscard]] const std::string& getType() const noexcept override { return type_; }
    [[nodiscard]] const std::string& getId() const noexcept override { return id_; }

    bool setParameter(const std::string& name, float value) noexcept override;
    [[nodiscard]] float getParameter(const std::string& name) const noexcept override;

    void prepare(uint32_t sample_rate, uint32_t max_block_size) override;
    void reset() noexcept override;

private:
    void updateCoeffs() noexcept;  // controle uniquement

    std::string id_;
    std::string type_{TYPE};

    // Params bruts (unites vraies), thread de controle
    std::atomic<float> low_gain_db_, low_freq_;
    std::atomic<float> peak_gain_db_, peak_freq_, peak_q_;
    std::atomic<float> high_gain_db_, high_freq_;
    uint32_t sample_rate_ = 48000;

    // 3 biquads x 5 coefficients, publies pour le thread audio
    struct Coeffs {
        std::atomic<double> b0{1.0}, b1{0.0}, b2{0.0}, a1{0.0}, a2{0.0};
    };
    Coeffs low_, peak_, high_;

    // Etat DF2T par biquad et par canal (thread audio seulement)
    struct State { double z1 = 0.0, z2 = 0.0; };
    State s_low_[2], s_peak_[2], s_high_[2];
};

}  // namespace daw::graph
