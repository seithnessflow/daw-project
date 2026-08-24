// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file drive_node.h
 * @brief Drive / saturation (builtin.drive) - session 4.3.
 *
 * Waveshaper tanh avec OVERSAMPLING 4x - l'aliasing est le seul piege
 * serieux ici, traite d'entree (brief) : interpolation polyphase (FIR
 * 65 taps, sinc fenetre Blackman, coefficients calcules au prepare en
 * double), tanh au taux 4x, decimation par le meme prototype. Les
 * histoires FIR sont preallouees ; rien n'alloue dans process().
 *
 * PREMIER NATIF A LATENCE NON NULLE - le client reel du PDC :
 * getLatencySamples() = 2 filtres lineaires-phase de 65 taps a 4x
 * = 2 * (64/2) / 4 = 16 echantillons de base, UN CALCUL (regle 2.4d).
 *
 * Params (unites vraies) : driveDb [0..36] (gain d'entree du shaper),
 * levelDb [-24..+6] (sortie), mix [0..1].
 */

#include "processor_node.h"

#include <array>
#include <atomic>
#include <string>

namespace daw::graph {

class DriveNode : public ProcessorNode {
public:
    static constexpr const char* TYPE = "builtin.drive";
    static constexpr uint32_t kOs = 4;      // facteur d'oversampling
    static constexpr uint32_t kTaps = 65;   // FIR lineaire-phase, (65-1)%8==0

    DriveNode(std::string id, float drive_db, float level_db, float mix);

    void process(float* output, const float* input, uint32_t frame_count,
                 int64_t position_samples) noexcept override;

    [[nodiscard]] const std::string& getType() const noexcept override { return type_; }
    [[nodiscard]] const std::string& getId() const noexcept override { return id_; }

    bool setParameter(const std::string& name, float value) noexcept override;
    [[nodiscard]] float getParameter(const std::string& name) const noexcept override;

    [[nodiscard]] uint32_t getLatencySamples() const noexcept override {
        // 2 FIR lineaires-phase de kTaps a 4x : 2*((kTaps-1)/2)/kOs
        return 2 * ((kTaps - 1) / 2) / kOs;
    }

    void prepare(uint32_t sample_rate, uint32_t max_block_size) override;
    void reset() noexcept override;

private:
    void updateGains() noexcept;

    std::string id_;
    std::string type_{TYPE};

    std::atomic<float> drive_db_, level_db_, mix_;
    std::atomic<double> pre_gain_{1.0}, post_gain_{1.0};

    // Prototype FIR (calcule au prepare, lu par le thread audio - fige
    // pendant l'activite, comme les coefficients d'EQ)
    std::array<double, kTaps> fir_{};

    // Histoires par canal (thread audio seulement)
    struct ChannelState {
        std::array<double, kTaps / kOs + 1> in_hist{};  // entree (taux base)
        std::array<double, kTaps> os_hist{};            // apres shaper (taux 4x)
        uint32_t in_pos = 0;
        uint32_t os_pos = 0;
    };
    ChannelState ch_[2];
};

}  // namespace daw::graph
