// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file export_job.h
 * @brief Export mixdown a la demande (AUDIT-6 quick win 1).
 *
 * INVARIANT DE THREAD (lecon AUDIT-5 C1, gravee) : le rendu offline
 * tourne sur UN THREAD OUVRIER DEDIE - jamais la boucle de controle
 * (elle resterait gelee 10-120 s), jamais le thread audio. Le demandeur
 * fournit un instantane d'OCTETS du document (pris sous doc_mutex par
 * l'appelant) ; l'ouvrier recharge sa propre copie et rend avec le
 * MEME noyau que --render (OfflineRenderer, SyncProxyNode bit-exact).
 *
 * UN SEUL export a la fois : start() refuse (retour false) tant que le
 * precedent n'est pas fini. Le callback on_done est appele DEPUIS le
 * thread ouvrier - il ne doit toucher que des objets thread-safe
 * (sendToAll du serveur WS l'est : copie sous verrou, envoi dehors).
 */

#include "offline_render.h"

#include <atomic>
#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <thread>
#include <vector>

namespace daw::render {

struct ExportParams {
    std::vector<uint8_t> doc_bytes;   // instantane Automerge (AMsave)
    std::string assets_dir;           // le store local du moteur live
    std::string host_exe;             // plugin_host pour les noeuds vst3
    std::map<std::string, std::string> vst3_modules;  // uid -> module
    uint32_t sample_rate = 48000;     // taux du rendu (celui du document)
    uint32_t bit_depth = 24;          // 16 | 24 | 32
};

struct ExportResult {
    bool ok = false;
    std::string error;
    std::string wav_hash;        // sha256 du WAV, pose dans assets_dir
    std::vector<uint8_t> wav_bytes;  // le fichier entier (pour le PUT store)
    int64_t samples_rendered = 0;
    uint32_t sample_rate = 0;
    uint32_t bit_depth = 0;
    bool clipped = false;
};

class ExportJob {
public:
    ExportJob() = default;
    ~ExportJob() { shutdown(); }

    ExportJob(const ExportJob&) = delete;
    ExportJob& operator=(const ExportJob&) = delete;

    /**
     * Lance un export sur le thread ouvrier. Retourne false si un export
     * est deja en cours (l'appelant signale le refus, le rendu en cours
     * n'est pas touche). on_done est appele une fois, du thread ouvrier.
     */
    bool start(ExportParams params, std::function<void(ExportResult)> on_done);

    [[nodiscard]] bool busy() const { return busy_.load(std::memory_order_acquire); }

    /** Fin de vie : attend l'ouvrier (aucune tache ne survit au moteur). */
    void shutdown();

private:
    std::thread worker_;
    std::atomic<bool> busy_{false};

    static ExportResult run(const ExportParams& params);
};

}  // namespace daw::render
