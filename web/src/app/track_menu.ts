// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Le bouton du COIN (2026-08-27, demande utilisateur : « il faut des
 * track midi et des tracks audio, tu peux mettre des options dans un
 * bouton dans le coin en haut a gauche ») : un « + » tout en haut a
 * gauche de la topbar qui ouvre le menu de creation - Piste audio /
 * Piste MIDI. Le vieux « + add track » du bas ouvre le MEME menu
 * (une seule verite de creation : makeTrackDef, source unique).
 *
 * Nommage : « Audio N » / « MIDI N » (N = compte du meme kind + 1) -
 * le nom dit le type, le badge de la tete de piste le confirme.
 */

import { ctx, els, sendLastChange } from './context';
import { makeTrackDef, type TrackKind } from '../document/schema';
import { renderTracks } from './render';
import { showContextMenu } from '../ui/context_menu';

function createTrack(kind: TrackKind): void {
  if (!ctx.project) return;
  const doc = ctx.project.getDocument();
  const n = doc.tracks.filter((t) => t.kind === kind).length + 1;
  const name = kind === 'audio' ? `Audio ${n}` : `MIDI ${n}`;
  const def = makeTrackDef(name, kind);
  ctx.project.addTrack(def);
  ctx.selectedTrackId = def.id;
  sendLastChange();
  renderTracks(true);
}

/** Ouvre le menu de creation a (x, y) - partage coin + bouton du bas. */
export function openNewTrackMenu(x: number, y: number): void {
  showContextMenu(x, y, [
    { label: '+ Piste audio', onClick: () => createTrack('audio') },
    { label: '+ Piste MIDI', onClick: () => createTrack('midi') },
  ]);
}

export function wireTrackMenu(): void {
  const corner = document.getElementById('new-track-btn');
  corner?.addEventListener('click', () => {
    const r = corner.getBoundingClientRect();
    openNewTrackMenu(r.left, r.bottom + 2);
  });
  // Le bouton du bas ouvre le meme menu (plus de piste sans type par
  // les CHEMINS DE CREATION - les pistes legacy existantes restent).
  els.addTrackBtn.addEventListener('click', () => {
    const r = els.addTrackBtn.getBoundingClientRect();
    openNewTrackMenu(r.left, r.top - 2);
  });
}
