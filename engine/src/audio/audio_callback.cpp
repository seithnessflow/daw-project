#include "audio_callback.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace daw::audio {

// Thread-local context pointer (set by AudioDevice before starting)
thread_local AudioCallbackContext* g_callback_context = nullptr;

void audioCallback(
    void* /*device*/,
    void* output,
    const void* /*input*/,
    uint32_t frame_count
) noexcept {
    // Sanity check - reject absurdly large frame counts
    constexpr uint32_t MAX_REASONABLE_FRAMES = 65536;
    if (frame_count > MAX_REASONABLE_FRAMES || frame_count == 0) {
        if (frame_count > 0) {
            std::memset(output, 0, frame_count * 2 * sizeof(float));
        }
        return;
    }

    // Get context - must be set before audio starts
    AudioCallbackContext* ctx = g_callback_context;
    if (!ctx) {
        // No context - output silence
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return;
    }

    float* out = static_cast<float*>(output);

    // Process any pending commands from control thread
    processCommands(*ctx);

    // Get the current graph (atomic load)
    graph::AudioGraph* graph = ctx->active_graph->load(std::memory_order_acquire);

    // Get transport state
    const bool is_playing = ctx->transport->isPlaying();
    int64_t position = ctx->transport->getPosition();

    if (!is_playing || !graph) {
        // Not playing or no graph - output silence
        std::memset(out, 0, frame_count * 2 * sizeof(float));

        // Still send telemetry
        sendTelemetry(*ctx, 0.0f, 0.0f);
        return;
    }

    // Process audio in fixed-size sub-blocks
    // This decouples the driver's frame_count from our internal buffer size
    uint32_t frames_written = 0;
    bool any_failure = false;

    while (frames_written < frame_count) {
        // Calculate chunk size (up to INTERNAL_BLOCK_SIZE)
        const uint32_t remaining = frame_count - frames_written;
        const uint32_t chunk = std::min(INTERNAL_BLOCK_SIZE, remaining);

        // Process this sub-block
        float* chunk_output = out + (frames_written * 2);  // stereo interleaved
        const bool success = graph->process(chunk_output, chunk, position);

        if (!success) {
            any_failure = true;
            std::memset(chunk_output, 0, chunk * 2 * sizeof(float));
        }

        position += static_cast<int64_t>(chunk);
        frames_written += chunk;
    }

    if (any_failure) {
        if (ctx->buffer_underrun_count) {
            ctx->buffer_underrun_count->fetch_add(1, std::memory_order_relaxed);
        }
    }

    // Advance transport position by total frames processed
    ctx->transport->advancePosition(static_cast<int64_t>(frame_count));

    // Calculate peaks over entire buffer and send telemetry
    const float peak_left = calculatePeak(out, frame_count, 0);
    const float peak_right = calculatePeak(out, frame_count, 1);
    sendTelemetry(*ctx, peak_left, peak_right);
}

void processCommands(AudioCallbackContext& ctx) noexcept {
    // Process all pending commands (non-blocking)
    while (auto cmd = ctx.command_buffer->pop()) {
        switch (cmd->command) {
            case AudioCommand::Play:
                ctx.transport->play();
                break;

            case AudioCommand::Stop:
                ctx.transport->stop();
                break;

            case AudioCommand::Seek:
                ctx.transport->seek(cmd->seek_position);
                break;

            case AudioCommand::UpdateGraph:
                // Graph swap is handled via atomic pointer
                // The control thread has already updated active_graph
                break;

            case AudioCommand::SetGain:
                // Per-track gain - handled via graph update
                break;

            case AudioCommand::None:
            default:
                break;
        }
    }
}

void sendTelemetry(
    AudioCallbackContext& ctx,
    float peak_left,
    float peak_right
) noexcept {
    // Create telemetry message
    AudioTelemetry telemetry{};
    telemetry.position_samples = ctx.transport->getPosition();
    telemetry.is_playing = ctx.transport->isPlaying();
    telemetry.peak_left = peak_left;
    telemetry.peak_right = peak_right;

    if (ctx.buffer_underrun_count) {
        telemetry.buffer_underruns = static_cast<uint32_t>(
            ctx.buffer_underrun_count->load(std::memory_order_relaxed)
        );
    }

    // Try to send - drop if buffer full (telemetry is best-effort)
    ctx.telemetry_buffer->push(telemetry);
}

float calculatePeak(
    const float* buffer,
    uint32_t frame_count,
    uint32_t channel
) noexcept {
    float peak = 0.0f;

    // Interleaved stereo: samples at indices channel, channel+2, channel+4, ...
    for (uint32_t i = 0; i < frame_count; ++i) {
        const float sample = buffer[i * 2 + channel];
        const float abs_sample = std::fabs(sample);
        if (abs_sample > peak) {
            peak = abs_sample;
        }
    }

    return peak;
}

}  // namespace daw::audio
