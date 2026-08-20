/**
 * @file create_test_doc.cpp
 * @brief Creates a test document and audio file for WASAPI testing.
 */

#include "../src/document/automerge_document.h"
#include "../src/document/schema.h"

#define _USE_MATH_DEFINES
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// Generate a WAV file with a 440Hz test tone
void createTestWav(const std::string& path, uint32_t sample_rate, uint32_t duration_seconds) {
    const uint32_t num_samples = sample_rate * duration_seconds;
    const uint32_t num_channels = 2;
    const uint32_t bits_per_sample = 16;
    const uint32_t byte_rate = sample_rate * num_channels * bits_per_sample / 8;
    const uint32_t block_align = num_channels * bits_per_sample / 8;
    const uint32_t data_size = num_samples * block_align;

    std::ofstream file(path, std::ios::binary);
    if (!file) {
        std::cerr << "Failed to create WAV file\n";
        return;
    }

    // RIFF header
    file.write("RIFF", 4);
    uint32_t chunk_size = 36 + data_size;
    file.write(reinterpret_cast<const char*>(&chunk_size), 4);
    file.write("WAVE", 4);

    // fmt chunk
    file.write("fmt ", 4);
    uint32_t fmt_size = 16;
    file.write(reinterpret_cast<const char*>(&fmt_size), 4);
    uint16_t audio_format = 1;  // PCM
    file.write(reinterpret_cast<const char*>(&audio_format), 2);
    uint16_t channels = num_channels;
    file.write(reinterpret_cast<const char*>(&channels), 2);
    uint32_t sr = sample_rate;
    file.write(reinterpret_cast<const char*>(&sr), 4);
    uint32_t br = byte_rate;
    file.write(reinterpret_cast<const char*>(&br), 4);
    uint16_t ba = block_align;
    file.write(reinterpret_cast<const char*>(&ba), 2);
    uint16_t bps = bits_per_sample;
    file.write(reinterpret_cast<const char*>(&bps), 2);

    // data chunk
    file.write("data", 4);
    uint32_t ds = data_size;
    file.write(reinterpret_cast<const char*>(&ds), 4);

    // Generate 440Hz sine wave at -12dB
    const double freq = 440.0;
    const double amplitude = 0.25;  // -12dB

    for (uint32_t i = 0; i < num_samples; ++i) {
        double t = static_cast<double>(i) / sample_rate;
        double value = amplitude * std::sin(2.0 * M_PI * freq * t);
        int16_t sample = static_cast<int16_t>(value * 32767.0);

        // Write stereo (same on both channels)
        file.write(reinterpret_cast<const char*>(&sample), 2);
        file.write(reinterpret_cast<const char*>(&sample), 2);
    }

    std::cout << "Created " << path << " (" << duration_seconds << " seconds, 440Hz)\n";
}

// Simple hash for asset identification
std::string computeHash(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return "";

    uint64_t hash = 0xcbf29ce484222325ULL;
    constexpr uint64_t prime = 0x100000001b3ULL;

    char buffer[4096];
    while (file.read(buffer, sizeof(buffer))) {
        for (size_t i = 0; i < sizeof(buffer); ++i) {
            hash ^= static_cast<uint8_t>(buffer[i]);
            hash *= prime;
        }
    }
    for (std::streamsize i = 0; i < file.gcount(); ++i) {
        hash ^= static_cast<uint8_t>(buffer[i]);
        hash *= prime;
    }

    char hex[17];
    snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(hash));
    return hex;
}

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: " << argv[0] << " <output.am> <assets_dir> [duration_seconds=600]\n";
        return 1;
    }

    std::string doc_path = argv[1];
    std::string assets_dir = argv[2];
    uint32_t duration = (argc > 3) ? std::atoi(argv[3]) : 600;  // Default 10 minutes

    // Create test WAV
    std::string wav_path = assets_dir + "/test_tone.wav";
    createTestWav(wav_path, 48000, duration);

    // Compute hash for asset
    std::string hash = computeHash(wav_path);
    std::cout << "Asset hash: " << hash << "\n";

    // Create document
    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cerr << "Failed to create document: " << doc.getLastError() << "\n";
        return 1;
    }

    // Add track with clip
    daw::document::TrackDef track;
    track.id = "track-1";
    track.name = "Test Tone";
    track.gain = 0.5f;

    daw::document::ClipDef clip;
    clip.id = "clip-1";
    clip.asset_hash = hash;
    clip.start_sample = 0;
    clip.length_samples = static_cast<int64_t>(duration) * 48000;
    clip.offset_samples = 0;
    track.clips.push_back(clip);

    doc.addTrack(track);

    // Save document
    std::vector<uint8_t> bytes = doc.toBytes();
    if (bytes.empty()) {
        std::cerr << "Serialization failed\n";
        return 1;
    }

    std::ofstream file(doc_path, std::ios::binary);
    if (!file) {
        std::cerr << "Failed to open output file\n";
        return 1;
    }

    file.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
    std::cout << "Created " << doc_path << " (" << bytes.size() << " bytes)\n";
    std::cout << "Duration: " << duration << " seconds\n";
    return 0;
}
