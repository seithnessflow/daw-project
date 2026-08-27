// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file transport_state.h
 * @brief Transport state management (play/stop/seek/position).
 *
 * This class manages the playback state using atomics for lock-free
 * access from both the audio thread and control thread.
 */

#include <atomic>
#include <cstdint>

namespace daw::transport {

/**
 * Transport state.
 *
 * Thread safety:
 * - All methods are lock-free
 * - Can be called from any thread
 */
class TransportState {
public:
    TransportState() = default;

    // Non-copyable (atomic members)
    TransportState(const TransportState&) = delete;
    TransportState& operator=(const TransportState&) = delete;

    /**
     * Start playback.
     */
    void play() noexcept {
        playing_.store(true, std::memory_order_release);
    }

    /**
     * Stop playback.
     */
    void stop() noexcept {
        playing_.store(false, std::memory_order_release);
    }

    /**
     * Check if currently playing.
     */
    [[nodiscard]] bool isPlaying() const noexcept {
        return playing_.load(std::memory_order_acquire);
    }

    /**
     * Get current playback position in samples.
     */
    [[nodiscard]] int64_t getPosition() const noexcept {
        return position_.load(std::memory_order_acquire);
    }

    /**
     * Seek to a specific position.
     *
     * @param position_samples Position in samples (must be >= 0)
     */
    void seek(int64_t position_samples) noexcept {
        if (position_samples >= 0) {
            position_.store(position_samples, std::memory_order_release);
        }
    }

    /**
     * Advance position by a number of samples.
     * Called by the audio thread after processing a buffer.
     *
     * @param samples Number of samples to advance
     */
    void advancePosition(int64_t samples) noexcept {
        position_.fetch_add(samples, std::memory_order_relaxed);
    }

    /**
     * Reset transport to initial state.
     */
    void reset() noexcept {
        playing_.store(false, std::memory_order_release);
        position_.store(0, std::memory_order_release);
    }

    /**
     * Set loop points (VIVANT depuis V1.1 - l'ancien « for future use »
     * mentait, famille F d'AUDIT-5) : le callback wrap sur ces braces
     * quand looping est actif.
     */
    void setLoopPoints(int64_t start, int64_t end) noexcept {
        loop_start_.store(start, std::memory_order_release);
        loop_end_.store(end, std::memory_order_release);
    }

    /**
     * BOUCLE UTILISATEUR (AUDIT-6 QW) : fin du CONTENU, rafraichie par le
     * control thread a chaque rebuild. C'est le point d'ARRET quand la
     * boucle est OFF - distinct des braces de boucle. Sans region
     * utilisateur, les braces suivent le contenu (comportement V1.1).
     */
    void setContentEnd(int64_t end) noexcept {
        content_end_.store(end, std::memory_order_release);
        if (!user_loop_.load(std::memory_order_acquire)) {
            setLoopPoints(0, end);
        }
    }

    [[nodiscard]] int64_t getContentEnd() const noexcept {
        return content_end_.load(std::memory_order_acquire);
    }

    /** Region de boucle posee par l'utilisateur : les rebuilds ne
     *  l'ecrasent plus tant qu'elle n'est pas effacee. */
    void setUserLoop(int64_t start, int64_t end) noexcept {
        user_loop_.store(true, std::memory_order_release);
        setLoopPoints(start, end);
    }

    /** Retour aux braces AUTO [0, fin du contenu]. */
    void clearUserLoop() noexcept {
        user_loop_.store(false, std::memory_order_release);
        setLoopPoints(0, content_end_.load(std::memory_order_acquire));
    }

    [[nodiscard]] bool hasUserLoop() const noexcept {
        return user_loop_.load(std::memory_order_acquire);
    }

    /**
     * Enable/disable looping (VIVANT depuis V1.1 - le callback l'honore).
     */
    void setLooping(bool enabled) noexcept {
        looping_.store(enabled, std::memory_order_release);
    }

    [[nodiscard]] bool isLooping() const noexcept {
        return looping_.load(std::memory_order_acquire);
    }

    [[nodiscard]] int64_t getLoopStart() const noexcept {
        return loop_start_.load(std::memory_order_acquire);
    }

    [[nodiscard]] int64_t getLoopEnd() const noexcept {
        return loop_end_.load(std::memory_order_acquire);
    }

private:
    std::atomic<bool> playing_{false};
    std::atomic<int64_t> position_{0};

    // Braces de boucle (wrap du callback) + fin de contenu (point d'arret
    // hors boucle) + drapeau region-utilisateur (les rebuilds respectent)
    std::atomic<bool> looping_{false};
    std::atomic<int64_t> loop_start_{0};
    std::atomic<int64_t> loop_end_{0};
    std::atomic<int64_t> content_end_{0};
    std::atomic<bool> user_loop_{false};
};

}  // namespace daw::transport
