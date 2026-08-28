// SPDX-License-Identifier: GPL-3.0-or-later
#include "audio_callback.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>

namespace daw::audio {

// Thread-local context pointer (set by AudioDevice before starting)
thread_local AudioCallbackContext* g_callback_context = nullptr;

namespace {

// Publishes the callback generation: odd while inside, even once out.
// Entry uses seq_cst: it closes the race where the control thread swaps the
// graph, snapshots an even generation and frees the old graph while a
// callback that entered concurrently still loaded the OLD pointer. With a
// seq_cst total order, a callback whose pointer-load preceded the swap has
// its entry increment visible to the control thread's snapshot (odd), so
// the control thread waits. RAII: every exit path publishes the exit.
struct GenGuard {
    std::atomic<uint64_t>* gen;

    explicit GenGuard(std::atomic<uint64_t>* g) noexcept : gen(g) {
        gen->fetch_add(1, std::memory_order_seq_cst);
    }

    ~GenGuard() noexcept {
        gen->fetch_add(1, std::memory_order_release);
    }
};

}  // namespace

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

    // Inside-the-callback marker: the control thread will not free a
    // retired graph while the generation is odd (see GenGuard above)
    GenGuard gen_guard(ctx->callback_generation);

    // Process any pending commands from control thread
    processCommands(*ctx);

    // A6 (mesure) : la forme reelle des callbacks (relaxed, lock-free)
    if (ctx->cb_total_count) {
        ctx->cb_total_count->fetch_add(1, std::memory_order_relaxed);
        if (frame_count % INTERNAL_BLOCK_SIZE != 0) {
            ctx->cb_partial_count->fetch_add(1, std::memory_order_relaxed);
        }
        uint32_t prev = ctx->cb_min_frames->load(std::memory_order_relaxed);
        while (frame_count < prev && !ctx->cb_min_frames
            ->compare_exchange_weak(prev, frame_count,
                                    std::memory_order_relaxed)) {}
        prev = ctx->cb_max_frames->load(std::memory_order_relaxed);
        while (frame_count > prev && !ctx->cb_max_frames
            ->compare_exchange_weak(prev, frame_count,
                                    std::memory_order_relaxed)) {}
    }

    // Raw pointer load: lock-free by static_assert. The pointed-to graph
    // cannot be freed while this callback runs (generation-gated retirement
    // on the control side).
    graph::AudioGraph* graph = ctx->active_graph->load(std::memory_order_acquire);

    // Get transport state
    const bool is_playing = ctx->transport->isPlaying();
    int64_t position = ctx->transport->getPosition();

    // F5 : on traite le graphe en LECTURE, ou si un slot de session est lance
    // (les slots jouent par-dessus un arrangement ARRETE - horloge de session
    // libre, position d'arrangement gelee). L'horloge avance a chaque bloc.
    // Vague 3 : le MIDI live arme (piste cible posee) traite aussi le graphe
    // a l'arret - c'est le monitoring d'un instrument, la timeline se tait
    // (etape 0, setTransportPlaying).
    const bool session_only =
        !is_playing && graph && (graph->anyLaunched() || graph->liveMidiArmed());
    if ((!is_playing && !session_only) || !graph) {
        // Not playing (and nothing launched) or no graph - output silence,
        // and the meters SAY silence (relaxed stores; stale peaks were
        // ghost-reported by telemetry forever after a stop)
        std::memset(out, 0, frame_count * 2 * sizeof(float));
        if (graph) graph->clearMeters();
        ctx->session_clock += static_cast<int64_t>(frame_count);  // reste continue
        // Still send telemetry
        sendTelemetry(*ctx, 0.0f, 0.0f);
        return;
    }

    // Loop / end-of-content policy (V1.1, region utilisateur AUDIT-6 QW).
    // Les braces vivent dans les atomics du transport ; le control thread
    // rafraichit la FIN DE CONTENU a chaque rebuild (setContentEnd), et la
    // region utilisateur (setUserLoop) survit aux rebuilds. Politique :
    // boucle ON -> wrap sur [loop_start, loop_end) ; boucle OFF -> lecture
    // jusqu'a la FIN DU CONTENU (une region posee mais boucle off ne coupe
    // JAMAIS la lecture - modele Live). Guard : bornes vides = ni wrap ni
    // stop (pas de spin a grain zero). Tout est lock-free.
    const bool looping = ctx->transport->isLooping();
    const int64_t loop_start = looping ? ctx->transport->getLoopStart() : 0;
    const int64_t loop_end = looping ? ctx->transport->getLoopEnd()
                                     : ctx->transport->getContentEnd();
    const bool bounded = loop_end > loop_start;

    // Process audio in fixed-size sub-blocks
    // This decouples the driver's frame_count from our internal buffer size
    uint32_t frames_written = 0;
    bool any_failure = false;

    while (frames_written < frame_count) {
        // La politique de boucle/fin ne s'applique qu'en LECTURE. En session
        // seule, la position d'arrangement est GELEE (les slots vivent sur
        // l'horloge de session, pas sur le transport).
        if (is_playing && bounded && position >= loop_end) {
            if (looping) {
                // Sample-accurate wrap BEFORE process: no rhythmic hole
                // of up to a driver buffer at each turn of the loop.
                position = loop_start;
            } else {
                // End of content, no loop: stop, park at end, silence the
                // tail of this buffer. The CLI exits on is_playing=false
                // in the telemetry (the control thread no longer stops).
                ctx->transport->stop();
                position = loop_end;
                std::memset(out + frames_written * 2, 0,
                            (frame_count - frames_written) * 2 * sizeof(float));
                break;
            }
        }

        // Calculate chunk size (up to INTERNAL_BLOCK_SIZE), bounded to the
        // loop brace so the wrap lands exactly on loop_end (en lecture).
        const uint32_t remaining = frame_count - frames_written;
        uint32_t chunk = std::min(INTERNAL_BLOCK_SIZE, remaining);
        if (is_playing && bounded && position + static_cast<int64_t>(chunk) > loop_end) {
            chunk = static_cast<uint32_t>(loop_end - position);
        }

        // F5 : l'horloge de session avance par SOUS-BLOC (sinon 2 sous-blocs
        // d'un meme callback verraient la meme position de slot).
        graph->setSessionClock(ctx->session_clock);
        ctx->session_clock += static_cast<int64_t>(chunk);
        // Etape 0 (Vague 3) : le graphe sait si le transport joue - a
        // l'arret (session seule, MIDI live) la timeline se tait.
        graph->setTransportPlaying(is_playing);

        // Vague 3 : drain de la file MIDI live pour CE sous-bloc (<= 64,
        // le reste attend le suivant). steady_clock::now() = QPC en mode
        // utilisateur (MSVC) / vDSO (glibc) : pas un syscall, un appel par
        // sous-bloc, seulement si l'entree est cablee.
        if (ctx->midi_in) {
            const int64_t now_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
                std::chrono::steady_clock::now().time_since_epoch()).count();
            const uint32_t n = daw::midi::drainLiveMidi(
                *ctx->midi_in, ctx->midi_stats, now_ns, ctx->live_midi,
                daw::midi::kLiveMidiMaxPerBlock);
            graph->setLiveMidi(ctx->live_midi, n, ctx->midi_stats);
        }

        // Process this sub-block
        float* chunk_output = out + (frames_written * 2);  // stereo interleaved
        const bool success = graph->process(chunk_output, chunk, position);

        if (!success) {
            any_failure = true;
            std::memset(chunk_output, 0, chunk * 2 * sizeof(float));
        }

        // S8a: the master tap hears exactly what the device hears
        // (post-master, silence-on-failure included). Lock-free push,
        // drop-newest on overrun - the sacred thread never waits.
        if (ctx->tap_ring) {
            ctx->tap_ring->pushSamples(chunk_output, chunk);
        }

        // La position d'arrangement n'avance qu'en LECTURE (gelee en session
        // seule - sinon seek() ci-dessous la ferait deriver).
        if (is_playing) position += static_cast<int64_t>(chunk);
        frames_written += chunk;
    }

    if (any_failure) {
        if (ctx->buffer_underrun_count) {
            ctx->buffer_underrun_count->fetch_add(1, std::memory_order_relaxed);
        }
    }

    // Publish the final (possibly wrapped) position. Single writer of
    // position_ during playback: browser SEEKs arrive through the command
    // ring (applied above in processCommands), and the control thread no
    // longer writes it (keepalive uses setLooping, auto-stop removed).
    // F5 : en session seule (arret), la position est gelee -> on ne seek pas
    // (sinon la tete d'arrangement deriverait pendant un jam de slots).
    if (is_playing) ctx->transport->seek(position);

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

            case AudioCommand::SetLoop:
                // Region utilisateur d'abord (le toggle s'applique apres,
                // pour que « poser une region » active la boucle d'un coup)
                if (cmd->clear_region) {
                    ctx.transport->clearUserLoop();
                } else if (cmd->set_region &&
                           cmd->loop_end > cmd->loop_start &&
                           cmd->loop_start >= 0) {
                    ctx.transport->setUserLoop(cmd->loop_start, cmd->loop_end);
                }
                ctx.transport->setLooping(cmd->loop_enabled);
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
