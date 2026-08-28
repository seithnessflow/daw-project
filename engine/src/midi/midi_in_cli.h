// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file midi_in_cli.h
 * @brief Le cote CLI / boucle de controle de l'entree MIDI live (hors
 * main.cpp, regle SPLITTER) : lister les ports, ouvrir, resoudre la piste
 * cible a chaque build, logguer les stats.
 *
 * CONTRATS DE LOG (consommes par web/tests/e2e/midi-in.spec.ts) :
 *   midi-in: opened "<port>"
 *   midi-in: -> track "<id>" (auto|--midi-track)
 *   midi-in: no instrument track yet (waiting for a vst3 node)
 *   midi-in stats: events=N forwarded=F dropped=D unrouted=U queue-lat last=X.X ms max=Y.Y ms pipeline~Z.Z ms
 */

#include "midi_input.h"

#include <cstdint>
#include <iosfwd>
#include <string>

namespace daw::graph { class AudioGraph; }

namespace daw::midi {

/** `--list-midi-devices` : imprime les ports, retourne 0. */
int listMidiDevicesCli();

/** Ouvre le port (message d'erreur en clair sur stderr si echec). */
bool openMidiInCli(const std::string& name, MidiInput& input,
                   LiveMidiQueue* queue, LiveMidiStats* stats);

/**
 * La piste cible du MIDI live pour CE graphe : `wanted_id` si donne et
 * trouve, sinon la premiere piste qui a un instrument (premier noeud
 * vst3). -1 = aucune. En mode serveur le document arrive apres le
 * demarrage : jamais un echec, un WARNING une fois (`warned`), et on
 * re-resout a chaque rebuild. Loggue la resolution quand elle change.
 */
int32_t resolveLiveMidiTrack(graph::AudioGraph& graph, const std::string& wanted_id,
                             bool& warned, std::string& last_logged);

/** La ligne de stats (cadence 5 s cote appelant). pipeline_ms = profondeur
 *  proxy x 256 + periode device, en ms : ce qui s'ajoute a la latence de
 *  FILE mesuree pour lire un total qui a un sens. */
void logMidiStats(const LiveMidiStats& stats, double pipeline_ms, std::ostream& out);

}  // namespace daw::midi
