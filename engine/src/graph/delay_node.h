// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file delay_node.h
 * @brief Delay (builtin.delay) - session 4.3. Temps en millisecondes
 * (en fractions de temps quand le tempo existera - brief), feedback,
 * mix.
 *
 * Ligne a retard PREALLOUEE dans prepare() (2 s max par canal) - rien
 * n'alloue dans process(). Temps arrondi a l'echantillon ENTIER : la
 * preuve du brief est « impulsion -> echo au bon echantillon pres,
 * decroissance conforme au feedback », et un retard fractionnaire
 * interpolerait cette exactitude. Latence PDC : zero (le retard EST
 * l'effet, pas un cout de traitement). Deterministe (etat initial nul).
 */

#include "processor_node.h"

#include <atomic>
#include <string>
#include <vector>

namespace daw::graph {

class DelayNode : public ProcessorNode {
public:
    static constexpr const char* TYPE = "builtin.delay";
    static constexpr float kMaxDelayMs = 2000.0f;

    DelayNode(std::string id, float time_ms, float feedback, float mix);

    void process(float* output, const float* input, uint32_t frame_count,
                 int64_t position_samples) noexcept override;

    [[nodiscard]] const std::string& getType() const noexcept override { return type_; }
    [[nodiscard]] const std::string& getId() const noexcept override { return id_; }

    bool setParameter(const std::string& name, float value) noexcept override;
    [[nodiscard]] float getParameter(const std::string& name) const noexcept override;

    void prepare(uint32_t sample_rate, uint32_t max_block_size) override;
    void reset() noexcept override;

private:
    std::string id_;
    std::string type_{TYPE};

    std::atomic<float> time_ms_, feedback_, mix_;
    std::atomic<uint32_t> delay_samples_{16800};  // derive de time_ms au prepare/set

    uint32_t sample_rate_ = 48000;
    // Ligne stereo entrelacee, taille figee au prepare (2 s max)
    std::vector<float> line_;
    uint32_t line_frames_ = 0;
    uint32_t write_ = 0;  // frame d'ecriture (thread audio seulement)
};

}  // namespace daw::graph
