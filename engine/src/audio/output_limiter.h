// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file output_limiter.h
 * @brief LE FUSIBLE DE SORTIE - limiteur brick-wall sur la sortie LIVE.
 *
 * Pose sur la PRISE, pas dans la partition : il ne vit ni dans le
 * document, ni dans les stems, ni dans l'export (les deux ancres de hash
 * ne le voient jamais - un rendu offline n'y passe pas). Il protege le DAC
 * et les moniteurs (T8V) d'un patch chaud, d'un CC mal mappe ou d'un
 * plugin qui repart faux apres un cold-restart. Un collaborateur ne peut
 * pas le supprimer : ce n'est pas un device, c'est une propriete de la
 * sortie de CE moteur.
 *
 * Algorithme (stereo lie, zero latence - la chaine live 16 ms ne gagne
 * pas un echantillon de retard) :
 * - attaque INSTANTANEE : si |x| * g depasse le plafond, g tombe a
 *   plafond/|x| sur l'echantillon meme (aucun depassement possible) ;
 * - relachement one-pole vers 1 (~80 ms par defaut) ;
 * - clamp dur final a +/- plafond (ceinture et bretelles) ;
 * - NaN / Inf -> 0 (un NaN qui atteint le DAC = bruit pleine echelle).
 * Sous le plafond, TRANSPARENT AU BIT PRES : g reste exactement 1.0f,
 * la multiplication est l'identite (gtest testOutputLimiter).
 *
 * THREAD SACRE : aucune allocation, aucun verrou ; les parametres sont
 * des atomiques lus une fois par bloc (static_assert lock-free dans
 * audio_callback.h). Les stats sont ecrites relaxed par le callback et
 * lues par le thread de controle (telemetrie EngineState).
 */

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace daw::audio {

class OutputLimiter {
public:
    static constexpr float kDefaultCeilingDb = -0.3f;
    static constexpr float kDefaultReleaseMs = 80.0f;

    OutputLimiter() noexcept { setCeilingDb(kDefaultCeilingDb); }

    /** Controle : plafond en dBFS (borne a [-24, 0]). Jamais dans le callback. */
    void setCeilingDb(float db) noexcept {
        db = std::clamp(db, -24.0f, 0.0f);
        ceiling_db_.store(db, std::memory_order_relaxed);
        ceiling_.store(std::pow(10.0f, db / 20.0f), std::memory_order_relaxed);
    }

    [[nodiscard]] float ceilingDb() const noexcept {
        return ceiling_db_.load(std::memory_order_relaxed);
    }

    void setEnabled(bool on) noexcept { enabled_.store(on, std::memory_order_relaxed); }
    [[nodiscard]] bool enabled() const noexcept { return enabled_.load(std::memory_order_relaxed); }

    /** Controle, avant start : coefficient de relachement pour ce taux. */
    void prepare(uint32_t sample_rate, float release_ms = kDefaultReleaseMs) noexcept {
        const float tau = release_ms * 0.001f * static_cast<float>(sample_rate);
        release_coeff_ = tau > 0.0f ? std::exp(-1.0 / tau) : 0.0;
        gain_ = 1.0;
    }

    /**
     * Thread audio : limite un bloc stereo entrelace EN PLACE.
     * Retourne la reduction de gain maximale du bloc (dB, >= 0).
     */
    float process(float* interleaved, uint32_t frame_count) noexcept {
        if (!enabled_.load(std::memory_order_relaxed)) {
            gain_ = 1.0;
            reduction_db_.store(0.0f, std::memory_order_relaxed);
            return 0.0f;
        }
        const float ceiling = ceiling_.load(std::memory_order_relaxed);
        // Le gain vit en DOUBLE : en float, le relachement one-pole
        // stagne a ~1e-4 sous 1 (le pas 1-d*coeff retombe sur le meme
        // float pres de 1.0 - mesure : bloque a 0.999886, jamais 1) et la
        // transparence exacte ne revient jamais.
        double g = gain_;
        double min_g = 1.0;
        bool engaged = false;

        for (uint32_t i = 0; i < frame_count; ++i) {
            float l = interleaved[i * 2];
            float r = interleaved[i * 2 + 1];
            // NaN / Inf : un fusible ne laisse pas passer l'infini
            if (!std::isfinite(l)) l = 0.0f;
            if (!std::isfinite(r)) r = 0.0f;

            const double peak = (std::max)(std::fabs(l), std::fabs(r));
            if (peak * g > ceiling) {
                g = ceiling / peak;          // attaque instantanee
                engaged = true;
            } else if (g < 1.0) {
                g = 1.0 - (1.0 - g) * release_coeff_;   // relachement
                if (g > 0.99999) g = 1.0;   // retour EXACT a l'identite
            }
            if (g < min_g) min_g = g;

            const float gf = static_cast<float>(g);  // 1.0 -> 1.0f : identite
            l *= gf;
            r *= gf;
            // Clamp dur : ceinture et bretelles
            interleaved[i * 2]     = std::clamp(l, -ceiling, ceiling);
            interleaved[i * 2 + 1] = std::clamp(r, -ceiling, ceiling);
        }
        gain_ = g;

        const float reduction_db = min_g < 1.0
            ? static_cast<float>(-20.0 * std::log10(min_g)) : 0.0f;
        // Tenue de crete entre deux lectures de telemetrie (30 Hz lit un
        // bloc sur ~6 : sans tenue, un transitoire d'un bloc n'est jamais vu)
        raise(reduction_db_, reduction_db);
        if (engaged) {
            engaged_blocks_.fetch_add(1, std::memory_order_relaxed);
            raise(max_reduction_db_, reduction_db);
        }
        return reduction_db;
    }

    /** Thread audio (arret) : l'etat de gain revient a l'identite. */
    void reset() noexcept {
        gain_ = 1.0;
        reduction_db_.store(0.0f, std::memory_order_relaxed);
    }

    // Stats (lues par la telemetrie, relaxed)
    /** Crete de reduction depuis la derniere prise (dB >= 0), sans la remettre. */
    [[nodiscard]] float reductionDb() const noexcept {
        return reduction_db_.load(std::memory_order_relaxed);
    }
    /** Telemetrie : la crete de reduction depuis la derniere prise, puis 0. */
    [[nodiscard]] float takeReductionDb() noexcept {
        return reduction_db_.exchange(0.0f, std::memory_order_relaxed);
    }
    [[nodiscard]] uint64_t engagedBlocks() const noexcept {
        return engaged_blocks_.load(std::memory_order_relaxed);
    }
    [[nodiscard]] float maxReductionDb() const noexcept {
        return max_reduction_db_.load(std::memory_order_relaxed);
    }
    /** Thread audio / test : le gain courant (1 = identite exacte). */
    [[nodiscard]] float currentGain() const noexcept { return static_cast<float>(gain_); }

private:
    static void raise(std::atomic<float>& slot, float value) noexcept {
        float prev = slot.load(std::memory_order_relaxed);
        while (value > prev &&
               !slot.compare_exchange_weak(prev, value, std::memory_order_relaxed)) {}
    }

    std::atomic<bool> enabled_{true};
    std::atomic<float> ceiling_db_{kDefaultCeilingDb};
    std::atomic<float> ceiling_{1.0f};     // lineaire, pose par setCeilingDb
    double release_coeff_ = 0.0;           // thread audio seul apres prepare
    double gain_ = 1.0;                    // thread audio seul (double : voir process)

    std::atomic<float> reduction_db_{0.0f};
    std::atomic<float> max_reduction_db_{0.0f};
    std::atomic<uint64_t> engaged_blocks_{0};
};

}  // namespace daw::audio
