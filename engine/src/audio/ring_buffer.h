#pragma once

/**
 * @file ring_buffer.h
 * @brief Lock-free Single Producer Single Consumer (SPSC) ring buffer.
 *
 * This ring buffer is designed for communication between threads where one
 * thread produces data and another consumes it, without any locks.
 *
 * Thread safety guarantees:
 * - Exactly ONE thread may call push()
 * - Exactly ONE thread may call pop()
 * - These may be different threads operating concurrently
 *
 * Memory ordering uses acquire-release semantics for correctness.
 */

#include <atomic>
#include <array>
#include <cstddef>
#include <optional>
#include <type_traits>

namespace daw::audio {

/**
 * Lock-free SPSC ring buffer.
 *
 * @tparam T Element type (must be trivially copyable for audio thread safety)
 * @tparam Capacity Buffer capacity (must be power of 2 for efficient modulo)
 */
template <typename T, std::size_t Capacity>
class RingBuffer {
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be a power of 2");
    static_assert(Capacity > 0, "Capacity must be positive");
    static_assert(std::is_trivially_copyable_v<T>, "T must be trivially copyable");

public:
    RingBuffer() : head_(0), tail_(0) {
        // Zero-initialize the buffer
        buffer_.fill(T{});
    }

    // Non-copyable, non-movable (atomic members)
    RingBuffer(const RingBuffer&) = delete;
    RingBuffer& operator=(const RingBuffer&) = delete;
    RingBuffer(RingBuffer&&) = delete;
    RingBuffer& operator=(RingBuffer&&) = delete;

    /**
     * Push an element onto the buffer.
     *
     * @param value The value to push
     * @return true if successful, false if buffer is full
     *
     * Thread: Producer only
     */
    [[nodiscard]] bool push(const T& value) noexcept {
        const std::size_t current_head = head_.load(std::memory_order_relaxed);
        const std::size_t next_head = (current_head + 1) & mask_;

        // Check if buffer is full
        if (next_head == tail_.load(std::memory_order_acquire)) {
            return false;
        }

        buffer_[current_head] = value;
        head_.store(next_head, std::memory_order_release);
        return true;
    }

    /**
     * Pop an element from the buffer.
     *
     * @return The popped value, or std::nullopt if buffer is empty
     *
     * Thread: Consumer only
     */
    [[nodiscard]] std::optional<T> pop() noexcept {
        const std::size_t current_tail = tail_.load(std::memory_order_relaxed);

        // Check if buffer is empty
        if (current_tail == head_.load(std::memory_order_acquire)) {
            return std::nullopt;
        }

        T value = buffer_[current_tail];
        tail_.store((current_tail + 1) & mask_, std::memory_order_release);
        return value;
    }

    /**
     * Peek at the next element without removing it.
     *
     * @return The next value, or std::nullopt if buffer is empty
     *
     * Thread: Consumer only
     */
    [[nodiscard]] std::optional<T> peek() const noexcept {
        const std::size_t current_tail = tail_.load(std::memory_order_relaxed);

        if (current_tail == head_.load(std::memory_order_acquire)) {
            return std::nullopt;
        }

        return buffer_[current_tail];
    }

    /**
     * Check if the buffer is empty.
     *
     * Note: This is a snapshot and may be stale by the time you act on it.
     */
    [[nodiscard]] bool empty() const noexcept {
        return head_.load(std::memory_order_acquire) ==
               tail_.load(std::memory_order_acquire);
    }

    /**
     * Check if the buffer is full.
     *
     * Note: This is a snapshot and may be stale by the time you act on it.
     */
    [[nodiscard]] bool full() const noexcept {
        const std::size_t next_head = (head_.load(std::memory_order_acquire) + 1) & mask_;
        return next_head == tail_.load(std::memory_order_acquire);
    }

    /**
     * Get the number of elements currently in the buffer.
     *
     * Note: This is a snapshot and may be stale by the time you act on it.
     */
    [[nodiscard]] std::size_t size() const noexcept {
        const std::size_t head = head_.load(std::memory_order_acquire);
        const std::size_t tail = tail_.load(std::memory_order_acquire);
        return (head - tail) & mask_;
    }

    /**
     * Get the buffer capacity.
     */
    [[nodiscard]] static constexpr std::size_t capacity() noexcept {
        return Capacity - 1;  // One slot is always empty to distinguish full from empty
    }

private:
    static constexpr std::size_t mask_ = Capacity - 1;

    alignas(64) std::atomic<std::size_t> head_;  // Written by producer
    alignas(64) std::atomic<std::size_t> tail_;  // Written by consumer
    std::array<T, Capacity> buffer_;
};

/**
 * Command types that can be sent to the audio thread.
 */
enum class AudioCommand : uint8_t {
    None = 0,
    Play,
    Stop,
    Seek,
    UpdateGraph,
    SetGain,
};

/**
 * A command message for the audio thread.
 * Trivially copyable for ring buffer safety.
 */
struct AudioCommandMessage {
    AudioCommand command = AudioCommand::None;
    int64_t seek_position = 0;  // For Seek command
    float gain_value = 1.0f;    // For SetGain command
    uint32_t track_index = 0;   // For track-specific commands
    void* graph_ptr = nullptr;  // For UpdateGraph (new graph pointer)
};

static_assert(std::is_trivially_copyable_v<AudioCommandMessage>);

/**
 * Telemetry data from the audio thread.
 */
struct AudioTelemetry {
    int64_t position_samples = 0;
    float peak_left = 0.0f;
    float peak_right = 0.0f;
    uint32_t buffer_underruns = 0;
    bool is_playing = false;
};

static_assert(std::is_trivially_copyable_v<AudioTelemetry>);

// Common ring buffer types
using CommandRingBuffer = RingBuffer<AudioCommandMessage, 256>;
using TelemetryRingBuffer = RingBuffer<AudioTelemetry, 64>;

}  // namespace daw::audio
