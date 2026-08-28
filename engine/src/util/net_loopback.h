// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file net_loopback.h
 * @brief `localhost` -> `127.0.0.1` dans une URL (ws/wss/http/https).
 *
 * MESURE 2026-08-28 : le serveur ecoute sur 127.0.0.1 seul ; ixwebsocket
 * resout `localhost` en `::1` D'ABORD et attend ~2 s que ce connect
 * loopback IPv6 tombe avant de retomber en IPv4 (curl fait la course des
 * deux et gagne en 400 ms). Chaque PUT/GET d'asset et la connexion WS du
 * moteur payaient 2 s - un gel de la boucle de controle a chaque capture
 * d'etat (telemetrie figee : « la note est muette » alors qu'elle jouait).
 * Ici on prefere l'adresse IPv4 de loopback quand l'hote est litteralement
 * `localhost` ; tout autre hote est laisse tel quel.
 */

#include <string>

namespace daw::util {

inline std::string preferIpv4Loopback(const std::string& url) {
    const std::string needle = "://localhost";
    const auto pos = url.find(needle);
    if (pos == std::string::npos) return url;
    const auto after = pos + needle.size();
    // `localhost` suivi de fin, de `:` ou de `/` seulement (pas localhost.foo)
    if (after < url.size() && url[after] != ':' && url[after] != '/') return url;
    return url.substr(0, pos) + "://127.0.0.1" + url.substr(after);
}

}  // namespace daw::util
