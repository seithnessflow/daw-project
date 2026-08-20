#pragma once

/**
 * @file processor_node.h
 * @brief Base interface for audio processing nodes.
 *
 * All processor nodes must implement this interface. Processing methods
 * may be called from the audio thread and must follow sacred thread rules.
 */

#include <cstdint>
#include <string>

namespace daw::graph {

/**
 * Base interface for audio processors.
 *
 * All methods that may be called from the audio thread are marked noexcept
 * and must not allocate, lock, or perform any blocking operations.
 */
class ProcessorNode {
public:
    virtual ~ProcessorNode() = default;

    /**
     * Process audio samples.
     *
     * AUDIO THREAD - Sacred thread rules apply.
     *
     * @param output Output buffer (interleaved stereo: L0,R0,L1,R1,...)
     * @param input Input buffer (same format), may be nullptr
     * @param frame_count Number of frames to process
     * @param position_samples Current timeline position in samples
     */
    virtual void process(
        float* output,
        const float* input,
        uint32_t frame_count,
        int64_t position_samples
    ) noexcept = 0;

    /**
     * Get the processor type identifier.
     */
    [[nodiscard]] virtual const std::string& getType() const noexcept = 0;

    /**
     * Get the processor instance ID.
     */
    [[nodiscard]] virtual const std::string& getId() const noexcept = 0;

    /**
     * Set a parameter value.
     *
     * This is called from the control thread. Parameter updates should be
     * atomic or use a mechanism that doesn't block the audio thread.
     *
     * @param name Parameter name
     * @param value New value
     * @return true if parameter was set successfully
     */
    virtual bool setParameter(const std::string& name, float value) noexcept = 0;

    /**
     * Get a parameter value.
     *
     * @param name Parameter name
     * @return Parameter value, or 0.0 if not found
     */
    [[nodiscard]] virtual float getParameter(const std::string& name) const noexcept = 0;

    /**
     * Prepare for playback.
     *
     * Called before audio processing starts. May allocate resources.
     *
     * @param sample_rate Sample rate in Hz
     * @param max_block_size Maximum block size that will be requested
     */
    virtual void prepare(uint32_t sample_rate, uint32_t max_block_size) = 0;

    /**
     * Reset internal state.
     *
     * Called when seeking or stopping. Should clear any internal buffers
     * or delay lines to prevent audio artifacts.
     */
    virtual void reset() noexcept = 0;
};

}  // namespace daw::graph
