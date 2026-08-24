// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file plugin_scan.h
 * @brief 2.5-decouverte : scan d'un dossier VST3 (intrants 2.5, mecanique 3).
 *
 * L'enumeration EXECUTE du code tiers : elle passe TOUJOURS par l'enfant
 * plugin_host --enumerate (crash-isole, timeout borne). Un module qui
 * echoue est memorise dans le cache (status=fail) et ne sera plus tente
 * tant que son (taille, mtime) ne change pas - la version scan de la
 * blacklist. Cache TSV a cote du binaire : un demarrage chaud ne spawne
 * aucun enfant.
 */

#include <ostream>
#include <string>
#include <vector>

namespace daw::host {

struct ScannedPlugin {
    std::string uid;          // 32-hex class id (Audio Module Class)
    std::string name;
    std::string vendor;
    std::string sub_categories;
    std::string module_path;
};

/**
 * Scanne `dir` (*.vst3, fichiers ET bundles), retourne les classes
 * Audio Module Class. `host_exe` = plugin_host pour l'enumeration ;
 * `cache_path` = fichier TSV (cree/mis a jour). Jamais d'exception :
 * un dossier absent = liste vide + une ligne de log.
 */
std::vector<ScannedPlugin> scanVst3Dir(const std::string& dir,
                                       const std::string& host_exe,
                                       const std::string& cache_path,
                                       std::ostream& log);

}  // namespace daw::host
