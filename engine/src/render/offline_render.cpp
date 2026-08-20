#include "offline_render.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>

namespace daw::render {

OfflineRenderer::OfflineRenderer() = default;
OfflineRenderer::~OfflineRenderer() = default;

RenderResult OfflineRenderer::render(
    const document::AutomergeDocument& document,
    const std::string& output_path,
    const std::string& asset_dir,
    const RenderConfig& config,
    RenderProgressCallback progress
) {
    RenderResult result;

    if (!document.isLoaded()) {
        result.error = "Document not loaded";
        return result;
    }

    const auto& doc = document.getDocument();

    // Build audio graph
    auto graph = buildGraph(document, asset_dir, config.sample_rate);
    if (!graph) {
        result.error = "Failed to build audio graph";
        return result;
    }

    graph->prepare(config.sample_rate, config.block_size);

    // Calculate render range
    int64_t start = config.start_sample;
    int64_t end = config.end_sample;
    if (end < 0) {
        end = calculateProjectLength(document);
    }

    if (end <= start) {
        result.error = "Invalid render range";
        return result;
    }

    const int64_t total_samples = end - start;

    // Calculate output size
    const uint32_t bytes_per_sample = config.bit_depth / 8;
    const uint32_t channels = 2;
    const uint32_t data_size = static_cast<uint32_t>(total_samples) * channels * bytes_per_sample;

    // Open output file
    std::ofstream file(output_path, std::ios::binary);
    if (!file) {
        result.error = "Failed to open output file: " + output_path;
        return result;
    }

    // Write WAV header
    if (!writeWavHeader(file, config.sample_rate, config.bit_depth, channels, data_size)) {
        result.error = "Failed to write WAV header";
        return result;
    }

    // Allocate buffers
    std::vector<float> float_buffer(config.block_size * channels);
    std::vector<uint8_t> int_buffer(config.block_size * channels * bytes_per_sample);

    // Render loop
    int64_t position = start;
    while (position < end) {
        // Calculate block size for this iteration
        const int64_t remaining = end - position;
        const uint32_t block_frames = static_cast<uint32_t>(
            std::min(remaining, static_cast<int64_t>(config.block_size))
        );

        // Clear buffer
        std::fill(float_buffer.begin(), float_buffer.end(), 0.0f);

        // Process
        graph->process(float_buffer.data(), block_frames, position);

        // Convert and accumulate peaks
        bool block_clipped = false;
        convertSamples(
            float_buffer.data(),
            int_buffer.data(),
            block_frames,
            config.bit_depth,
            result.peak_left,
            result.peak_right,
            block_clipped
        );

        if (block_clipped) {
            result.clipped = true;
        }

        // Write to file
        const size_t write_size = block_frames * channels * bytes_per_sample;
        file.write(reinterpret_cast<const char*>(int_buffer.data()), write_size);

        if (!file.good()) {
            result.error = "Write error";
            return result;
        }

        result.samples_rendered += block_frames;
        position += block_frames;

        // Progress callback
        if (progress) {
            if (!progress(position - start, total_samples)) {
                result.error = "Cancelled";
                return result;
            }
        }
    }

    result.success = true;
    return result;
}

int64_t OfflineRenderer::calculateProjectLength(const document::AutomergeDocument& document) {
    int64_t max_end = 0;

    for (const auto& track : document.getDocument().tracks) {
        for (const auto& clip : track.clips) {
            const int64_t clip_end = clip.start_sample + clip.length_samples;
            if (clip_end > max_end) {
                max_end = clip_end;
            }
        }
    }

    return max_end;
}

std::unique_ptr<graph::AudioGraph> OfflineRenderer::buildGraph(
    const document::AutomergeDocument& document,
    const std::string& asset_dir,
    uint32_t sample_rate
) {
    auto graph_ptr = std::make_unique<graph::AudioGraph>();
    graph_ptr->setSampleRate(sample_rate);

    const auto& doc = document.getDocument();

    for (const auto& track_def : doc.tracks) {
        graph::AudioTrack track;
        track.id = track_def.id;
        track.name = track_def.name;
        track.gain = track_def.gain;

        // Load clips
        for (const auto& clip_def : track_def.clips) {
            graph::ClipPlayer player;

            graph::ClipInfo info;
            info.id = clip_def.id;
            info.asset_hash = clip_def.asset_hash;
            info.start_sample = clip_def.start_sample;
            info.length_samples = clip_def.length_samples;
            info.offset_samples = clip_def.offset_samples;
            player.setClip(info);

            // Try to load asset by hash (look in asset_dir)
            // For now, we look for files matching the hash
            std::string asset_path = asset_dir + "/" + clip_def.asset_hash + ".wav";
            const graph::AudioAsset* asset = asset_cache_.loadOrGet(asset_path);

            // If not found by hash, try loading all wavs in the directory
            // This is a fallback for testing
            if (!asset) {
                // Try with original filename if stored somewhere
                // For slice 1, we'll require hash-named files
            }

            if (asset) {
                player.setAsset(asset);
            }

            track.clips.push_back(std::move(player));
        }

        // Create processors
        for (const auto& proc_def : track_def.chain) {
            if (proc_def.type == graph::GainNode::TYPE) {
                float gain = 1.0f;
                auto it = proc_def.params.find("gain");
                if (it != proc_def.params.end()) {
                    gain = it->second;
                }
                auto node = std::make_unique<graph::GainNode>(proc_def.id, gain);
                track.chain.push_back(std::move(node));
            }
        }

        graph_ptr->addTrack(std::move(track));
    }

    return graph_ptr;
}

bool OfflineRenderer::writeWavHeader(
    std::ofstream& file,
    uint32_t sample_rate,
    uint32_t bit_depth,
    uint32_t channels,
    uint32_t data_size
) {
    const uint32_t bytes_per_sample = bit_depth / 8;
    const uint32_t byte_rate = sample_rate * channels * bytes_per_sample;
    const uint16_t block_align = static_cast<uint16_t>(channels * bytes_per_sample);
    const uint32_t file_size = 36 + data_size;

    // RIFF header
    file.write("RIFF", 4);
    file.write(reinterpret_cast<const char*>(&file_size), 4);
    file.write("WAVE", 4);

    // fmt chunk
    file.write("fmt ", 4);
    uint32_t fmt_size = 16;
    file.write(reinterpret_cast<const char*>(&fmt_size), 4);

    uint16_t audio_format = 1;  // PCM
    file.write(reinterpret_cast<const char*>(&audio_format), 2);

    uint16_t num_channels = static_cast<uint16_t>(channels);
    file.write(reinterpret_cast<const char*>(&num_channels), 2);

    file.write(reinterpret_cast<const char*>(&sample_rate), 4);
    file.write(reinterpret_cast<const char*>(&byte_rate), 4);
    file.write(reinterpret_cast<const char*>(&block_align), 2);

    uint16_t bits = static_cast<uint16_t>(bit_depth);
    file.write(reinterpret_cast<const char*>(&bits), 2);

    // data chunk
    file.write("data", 4);
    file.write(reinterpret_cast<const char*>(&data_size), 4);

    return file.good();
}

void OfflineRenderer::convertSamples(
    const float* input,
    uint8_t* output,
    uint32_t frame_count,
    uint32_t bit_depth,
    double& peak_left,
    double& peak_right,
    bool& clipped
) {
    const uint32_t channels = 2;

    for (uint32_t i = 0; i < frame_count; ++i) {
        for (uint32_t ch = 0; ch < channels; ++ch) {
            float sample = input[i * channels + ch];

            // Track peaks
            const double abs_sample = std::fabs(sample);
            if (ch == 0 && abs_sample > peak_left) {
                peak_left = abs_sample;
            } else if (ch == 1 && abs_sample > peak_right) {
                peak_right = abs_sample;
            }

            // Clip detection
            if (sample > 1.0f || sample < -1.0f) {
                clipped = true;
                sample = std::clamp(sample, -1.0f, 1.0f);
            }

            // Convert to integer format
            if (bit_depth == 16) {
                int16_t int_sample = static_cast<int16_t>(sample * 32767.0f);
                output[(i * channels + ch) * 2]     = static_cast<uint8_t>(int_sample & 0xFF);
                output[(i * channels + ch) * 2 + 1] = static_cast<uint8_t>((int_sample >> 8) & 0xFF);
            } else if (bit_depth == 24) {
                int32_t int_sample = static_cast<int32_t>(sample * 8388607.0f);
                output[(i * channels + ch) * 3]     = static_cast<uint8_t>(int_sample & 0xFF);
                output[(i * channels + ch) * 3 + 1] = static_cast<uint8_t>((int_sample >> 8) & 0xFF);
                output[(i * channels + ch) * 3 + 2] = static_cast<uint8_t>((int_sample >> 16) & 0xFF);
            } else if (bit_depth == 32) {
                int32_t int_sample = static_cast<int32_t>(sample * 2147483647.0f);
                output[(i * channels + ch) * 4]     = static_cast<uint8_t>(int_sample & 0xFF);
                output[(i * channels + ch) * 4 + 1] = static_cast<uint8_t>((int_sample >> 8) & 0xFF);
                output[(i * channels + ch) * 4 + 2] = static_cast<uint8_t>((int_sample >> 16) & 0xFF);
                output[(i * channels + ch) * 4 + 3] = static_cast<uint8_t>((int_sample >> 24) & 0xFF);
            }
        }
    }
}

}  // namespace daw::render
