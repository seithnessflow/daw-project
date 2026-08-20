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
     * Set loop points (for future use).
     * Currently stored but not enforced.
     */
    void setLoopPoints(int64_t start, int64_t end) noexcept {
        loop_start_.store(start, std::memory_order_release);
        loop_end_.store(end, std::memory_order_release);
    }

    /**
     * Enable/disable looping (for future use).
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

    // Loop points (for future use)
    std::atomic<bool> looping_{false};
    std::atomic<int64_t> loop_start_{0};
    std::atomic<int64_t> loop_end_{0};
};

}  // namespace daw::transport
