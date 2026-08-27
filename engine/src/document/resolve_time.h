// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file resolve_time.h
 * @brief T2 : LE point d'etranglement temps musical -> samples.
 *
 * resolveMusicalTime() remplit les champs samples des objets MUSICAUX
 * (clips/notes a start_tick, lanes timeBase ticks) via le noyau tempo
 * (graph/tempo.h, miroir de tempo.ts) ; les objets ABSOLUS passent
 * BYTE-IDENTIQUES. Appele UNE fois par entree du moteur :
 *   - rebuild live (main.cpp, AVANT buildGraph et content_end),
 *   - offline_render (render + calculateProjectLength),
 *   - publication/fraicheur des stems (les cles serialisent des
 *     samples RESOLUS - les clips absolus donnent des cles inchangees).
 * En AVAL de ce point, le graphe/les renderers ne voient QUE des
 * samples : audio_graph, clip_player, midi_schedule, automation,
 * graph_common restent INTOUCHES.
 *
 * Regle des durees : duree = DIFFERENCE de positions resolues
 * (samplesAtTick(a+len) - samplesAtTick(a)) - deux clips musicaux
 * adjacents restent sans couture par construction.
 */

#include "schema.h"

namespace daw::document {

/**
 * Resout les positions musicales du document EN PLACE. Un document v1
 * pur (schema_version < 2) retourne immediatement : zero mutation.
 */
void resolveMusicalTime(ProjectDef& doc);

/**
 * F5+ musical : le quantum Session d'un doc v2 = 1 MESURE (signature
 * a tick 0, 4/4 par defaut) resolue au REGISTRE de tempo. Retourne 0
 * pour un doc v1 (le quantum legacy = loop_len du slot d'ancre reste).
 * Echantillonne AU LAUNCH par le graphe : un changement de tempo
 * n'affecte que les prochains lancements.
 */
int64_t sessionQuantumSamples(const ProjectDef& doc);

}  // namespace daw::document
