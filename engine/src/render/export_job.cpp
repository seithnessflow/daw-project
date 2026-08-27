// SPDX-License-Identifier: GPL-3.0-or-later
#include "export_job.h"

#include "../document/automerge_document.h"
#include "../util/sha256.h"

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>

namespace fs = std::filesystem;

namespace daw::render {

bool ExportJob::start(ExportParams params,
                      std::function<void(ExportResult)> on_done) {
    bool expected = false;
    if (!busy_.compare_exchange_strong(expected, true,
                                       std::memory_order_acq_rel)) {
        return false;  // un export a la fois - l'appelant signale le refus
    }
    // Le precedent ouvrier est FINI (busy_ etait false) : on peut joindre
    // son thread sans attendre avant d'en lancer un nouveau.
    if (worker_.joinable()) worker_.join();

    worker_ = std::thread([this, params = std::move(params),
                           on_done = std::move(on_done)]() {
        ExportResult result = run(params);
        // busy_ retombe AVANT le callback : un enchainement immediat
        // (l'utilisateur relance) trouve la place libre.
        busy_.store(false, std::memory_order_release);
        if (on_done) on_done(std::move(result));
    });
    return true;
}

void ExportJob::shutdown() {
    if (worker_.joinable()) worker_.join();
}

ExportResult ExportJob::run(const ExportParams& params) {
    ExportResult out;
    out.sample_rate = params.sample_rate;
    out.bit_depth = params.bit_depth;

    // 1. Recharger l'instantane dans une copie PRIVEE du document -
    //    l'ouvrier ne touche jamais le document vivant ni son mutex.
    daw::document::AutomergeDocument doc;
    if (!doc.loadFromBytes(params.doc_bytes.data(), params.doc_bytes.size())) {
        out.error = "document snapshot unreadable: " + doc.getLastError();
        return out;
    }

    // 2. Rendu vers un fichier temporaire (le hash n'existe pas encore).
    const auto tmp_name = "daw-export-" +
        std::to_string(std::chrono::steady_clock::now()
                           .time_since_epoch().count()) + ".wav";
    std::error_code ec;
    const fs::path tmp_path = fs::temp_directory_path(ec) / tmp_name;
    if (ec) {
        out.error = "no temp directory: " + ec.message();
        return out;
    }

    RenderConfig config;
    config.sample_rate = params.sample_rate;
    config.bit_depth = params.bit_depth;

    OfflineRenderer renderer;
    if (!params.vst3_modules.empty()) {
        renderer.setVst3Modules(params.vst3_modules, params.host_exe);
    }
    auto render_result = renderer.render(doc, tmp_path.string(),
                                         params.assets_dir, config);
    if (!render_result.success) {
        fs::remove(tmp_path, ec);
        out.error = render_result.error;
        return out;
    }
    out.samples_rendered = render_result.samples_rendered;
    out.clipped = render_result.clipped;

    // 3. Lire le WAV entier, le hacher, le poser dans le store LOCAL
    //    sous son adresse de contenu (tmp + rename, jamais un partiel).
    std::ifstream in(tmp_path, std::ios::binary);
    if (!in) {
        out.error = "rendered file unreadable: " + tmp_path.string();
        return out;
    }
    out.wav_bytes.assign(std::istreambuf_iterator<char>(in),
                         std::istreambuf_iterator<char>());
    in.close();
    if (out.wav_bytes.empty()) {
        fs::remove(tmp_path, ec);
        out.error = "rendered file is empty";
        return out;
    }
    out.wav_hash = daw::util::sha256Hex(out.wav_bytes.data(),
                                        out.wav_bytes.size());

    fs::create_directories(params.assets_dir, ec);
    const fs::path final_path =
        fs::path(params.assets_dir) / (out.wav_hash + ".wav");
    fs::rename(tmp_path, final_path, ec);
    if (ec) {
        // Rename inter-volume (TEMP et assets sur deux disques) : copier.
        ec.clear();
        fs::copy_file(tmp_path, final_path,
                      fs::copy_options::overwrite_existing, ec);
        fs::remove(tmp_path);
        if (ec) {
            out.error = "cannot place WAV in assets dir: " + ec.message();
            return out;
        }
    }

    std::cout << "Export mixdown rendered: " << out.wav_hash << " ("
              << out.samples_rendered << " samples, "
              << out.bit_depth << "-bit"
              << (out.clipped ? ", CLIPPED" : "") << ")\n";
    out.ok = true;
    return out;
}

}  // namespace daw::render
