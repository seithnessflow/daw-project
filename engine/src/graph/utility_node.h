// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file utility_node.h
 * @brief Utility (builtin.utility) - le device de cablage des effets
 * natifs (session 4.1) : gain, pan, mono, inversion de phase.
 *
 * Lois du moteur (brief effets natifs, non negociables) :
 * - RIEN n'alloue/verrouille/logge dans process() ; la matrice 2x2 de
 *   canaux est recalculee HORS callback (constructeur / setParameter)
 *   et lissee one-pole 5 ms dans le callback (le moule GainNode).
 * - Deterministe : memes entrees + memes params = memes octets (le
 *   lisseur demarre SUR la cible au constructeur - un rendu offline
 *   d'un graphe frais est une multiplication constante exacte).
 * - Latence : zero, declaree (getLatencySamples par defaut = 0).
 *
 * Pan = loi de BALANCE a centre UNITE (pan<=0 : L=1, R=1+pan ;
 * pan>=0 : R=1, L=1-pan) - un Utility au centre est transparent au
 * bit pres, contrairement a la loi constant-power (-3 dB au centre)
 * reservee au pan de PISTE (TODO 3c).
 */

#include "processor_node.h"

#include <atomic>
#include <string>

namespace daw::graph {

class UtilityNode : public ProcessorNode {
public:
    static constexpr const char* TYPE = "builtin.utility";
    static constexpr const char* PARAM_GAIN = "gain";    // lineaire 0..2
    static constexpr const char* PARAM_PAN = "pan";      // -1..+1, balance
    static constexpr const char* PARAM_MONO = "mono";    // 0|1
    static constexpr const char* PARAM_PHASE = "phase";  // 0|1 (inversion)

    UtilityNode(std::string id, float gain, float pan, bool mono, bool phase);

    void process(float* output, const float* input, uint32_t frame_count,
                 int64_t position_samples) noexcept override;

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

private:
    // Controle -> matrice cible (jamais dans le callback)
    void updateMatrix() noexcept;

    std::string id_;
    std::string type_{TYPE};

    // Params bruts (ecrits controle, relus par updateMatrix controle)
    std::atomic<float> gain_;
    std::atomic<float> pan_;
    std::atomic<bool> mono_;
    std::atomic<bool> phase_;

    // Matrice cible [out] = m * [in] : ll lr / rl rr (atomiques : le
    // callback ne lit que ces quatre-la)
    std::atomic<float> t_ll_{1.0f}, t_lr_{0.0f}, t_rl_{0.0f}, t_rr_{1.0f};

    // Etat de lissage (thread audio seulement)
    float s_ll_ = 1.0f, s_lr_ = 0.0f, s_rl_ = 0.0f, s_rr_ = 1.0f;
    float smooth_coeff_ = 0.0f;
};

}  // namespace daw::graph
