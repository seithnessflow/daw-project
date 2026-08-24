// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file compressor_node.h
 * @brief Compresseur (builtin.comp) - session 4.2, celui de la basse.
 *
 * Feed-forward classique : detecteur de crete stereo-lie
 * (max(|L|,|R|)) suivi en LINEAIRE par attaque/release one-pole, gain
 * calcule en dB (over = env - threshold ; reduction = over*(1-1/ratio)
 * au-dela du seuil), makeup en sortie. Coefficients d'attaque/release
 * calcules HORS callback (prepare/setParameter) ; etat du detecteur en
 * double, thread audio seulement. Rien n'alloue/verrouille/logge dans
 * process(). Latence : zero (pas de lookahead - il viendra avec son
 * PDC le jour ou on le voudra). Deterministe.
 *
 * Params (unites vraies) : thresholdDb [-60..0], ratio [1..20],
 * attackMs [0.1..100], releaseMs [5..1000], makeupDb [0..24].
 */

#include "processor_node.h"

#include <atomic>
#include <string>

namespace daw::graph {

class CompressorNode : public ProcessorNode {
public:
    static constexpr const char* TYPE = "builtin.comp";

    CompressorNode(std::string id, float threshold_db, float ratio,
                   float attack_ms, float release_ms, float makeup_db);

    void process(float* output, const float* input, uint32_t frame_count,
                 int64_t position_samples) noexcept override;

    [[nodiscard]] const std::string& getType() const noexcept override { return type_; }
    [[nodiscard]] const std::string& getId() const noexcept override { return id_; }

    bool setParameter(const std::string& name, float value) noexcept override;
    [[nodiscard]] float getParameter(const std::string& name) const noexcept override;

    void prepare(uint32_t sample_rate, uint32_t max_block_size) override;
    void reset() noexcept override;

private:
    void updateDerived() noexcept;  // controle uniquement

    std::string id_;
    std::string type_{TYPE};

    std::atomic<float> threshold_db_, ratio_, attack_ms_, release_ms_, makeup_db_;
    uint32_t sample_rate_ = 48000;

    // Derives publies pour le thread audio
    std::atomic<double> attack_coeff_{0.0}, release_coeff_{0.0};
    std::atomic<double> makeup_lin_{1.0};
    std::atomic<double> threshold_lin_{1.0};
    std::atomic<double> slope_{0.0};  // 1 - 1/ratio

    // Etat du detecteur (thread audio seulement)
    double envelope_ = 0.0;  // lineaire
};

}  // namespace daw::graph
