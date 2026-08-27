// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * T3 : LE POINT DE BRANCHE GEOMETRIE. Tout consommateur web qui veut
 * la position/duree d'un clip en SAMPLES passe par ici — jamais par
 * clip.startSample directement (un clip MUSICAL n'en a pas : sa verite
 * est startTick, resolue par le noyau tempo, miroir du moteur
 * resolveMusicalTime).
 *
 * Memoisation par IDENTITE de document : Automerge produit un nouvel
 * objet a chaque change -> la table (carte effective + frontieres) se
 * recalcule une fois par version, pas par clip.
 */

import type { ClipDef, NoteDef, ProjectDef } from './schema';
import { effectiveTempoMap, isMusicalClip } from './schema';
import type { TempoPoint } from './tempo';
import { buildBoundaryTable, samplesAtTick, tickAtSample } from './tempo';

interface Resolver {
  map: TempoPoint[];
  S: bigint[];
  sr: number;
}

const cache = new WeakMap<object, Resolver>();

function resolverFor(doc: ProjectDef): Resolver {
  let r = cache.get(doc);
  if (!r) {
    const map = effectiveTempoMap(doc);
    r = { map, S: buildBoundaryTable(map, doc.sampleRate), sr: doc.sampleRate };
    cache.set(doc, r);
  }
  return r;
}

/** Position timeline (samples) d'un clip — LA porte unique. */
export function clipStartSamples(clip: ClipDef, doc: ProjectDef): number {
  if (isMusicalClip(clip)) {
    const r = resolverFor(doc);
    return samplesAtTick(r.map, r.S, r.sr, clip.startTick!);
  }
  return clip.startSample ?? 0;
}

/** Duree (samples) d'un clip. Un clip MIDI musical derive sa duree de
 *  la DIFFERENCE de positions (adjacence sans couture) ; un clip audio
 *  musical garde lengthSamples (contenu jamais etire). */
export function clipLengthSamples(clip: ClipDef, doc: ProjectDef): number {
  if (isMusicalClip(clip) && typeof clip.lengthTick === 'number') {
    const r = resolverFor(doc);
    return samplesAtTick(r.map, r.S, r.sr, clip.startTick! + clip.lengthTick) -
      samplesAtTick(r.map, r.S, r.sr, clip.startTick!);
  }
  return clip.lengthSamples ?? 0;
}

/** Fin timeline (samples) d'un clip — l'idiome start+length centralise. */
export function clipEndSamples(clip: ClipDef, doc: ProjectDef): number {
  return clipStartSamples(clip, doc) + clipLengthSamples(clip, doc);
}

/** Position (samples, relative au clip) d'une note. Le domaine du clip
 *  parent gouverne : notes musicales resolues sur la timeline puis
 *  re-relativisees (miroir exact de resolveMusicalTime). */
export function noteStartSamples(note: NoteDef, clip: ClipDef,
  doc: ProjectDef): number {
  if (isMusicalClip(clip) && typeof note.startTick === 'number') {
    const r = resolverFor(doc);
    return samplesAtTick(r.map, r.S, r.sr, clip.startTick! + note.startTick) -
      samplesAtTick(r.map, r.S, r.sr, clip.startTick!);
  }
  return note.startSample ?? 0;
}

export function noteLengthSamples(note: NoteDef, clip: ClipDef,
  doc: ProjectDef): number {
  if (isMusicalClip(clip) && typeof note.startTick === 'number' &&
      typeof note.lengthTick === 'number') {
    const r = resolverFor(doc);
    const abs = clip.startTick! + note.startTick;
    return samplesAtTick(r.map, r.S, r.sr, abs + note.lengthTick) -
      samplesAtTick(r.map, r.S, r.sr, abs);
  }
  return note.lengthSamples ?? 0;
}

/** Pipeline gestes px -> sec -> sample -> TICK pour cibles musicales
 *  (tickAtSample est UI-only : il ne persiste jamais une verite
 *  derivee de samples EXISTANTS, seulement la CIBLE d'un geste). */
export function sampleToTick(doc: ProjectDef, sample: number): number {
  const r = resolverFor(doc);
  return tickAtSample(r.map, r.S, r.sr, sample);
}

/** L'inverse pour l'affichage (regle, previsualisation de snap). */
export function tickToSample(doc: ProjectDef, tick: number): number {
  const r = resolverFor(doc);
  return samplesAtTick(r.map, r.S, r.sr, tick);
}
