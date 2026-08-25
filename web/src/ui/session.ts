// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Vue Session (Refonte T7) : le clip-launcher facon Ableton. Grille
 * scenes (lignes) x pistes (colonnes) de SLOTS. Un slot = un clip de session
 * (ClipDef avec sceneId) ; le moteur ignore ces clips en timeline. Cliquer
 * un slot vide en cree un (MIDI) ; cliquer un slot plein selectionne sa piste
 * (editable au piano-roll). Le LAUNCH live (jouer le slot) = T7b.
 */

import { ctx, sendLastChange } from '../app/context';
import { renderTracks } from '../app/render';
import { trackHue } from './track';

// F5 : etat "en lecture" des slots - PRESENTATION LOCALE (le launch est un
// signal moteur, pas le document). Cle = `${sceneId}::${trackId}`. Persiste
// entre les rendus (renderSession se rappelle a chaque changement de doc).
const playing = new Set<string>();
const slotKey = (sceneId: string, trackId: string): string => `${sceneId}::${trackId}`;

/** Lance/arrete un slot (moteur) et met a jour l'etat visuel local. */
function toggleSlot(sceneId: string, trackId: string): void {
  const key = slotKey(sceneId, trackId);
  const on = !playing.has(key);
  if (on) playing.add(key); else playing.delete(key);
  ctx.engineClient?.sessionLaunch(sceneId, trackId, !on);
  renderSession();
}

/** Lance/arrete toute une scene (toutes les pistes qui ont un slot). */
function toggleScene(sceneId: string, trackIds: string[]): void {
  // si au moins un slot de la scene joue -> on arrete tout, sinon on lance tout
  const anyOn = trackIds.some((t) => playing.has(slotKey(sceneId, t)));
  const stop = anyOn;
  for (const t of trackIds) {
    const key = slotKey(sceneId, t);
    if (stop) playing.delete(key); else playing.add(key);
  }
  ctx.engineClient?.sessionLaunch(sceneId, '', stop);
  renderSession();
}

export function renderSession(): void {
  const slot = document.getElementById('session-slot');
  if (!slot || !ctx.project) return;
  const doc = ctx.project.getDocument();
  const tracks = doc.tracks;
  const scenes = (doc.scenes as { id: string; name: string }[] | undefined) ?? [];

  slot.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'session-grid';
  grid.style.setProperty('--cols', String(tracks.length));

  // En-tete : coin + nom de chaque piste
  const corner = document.createElement('div');
  corner.className = 'ss-corner';
  corner.textContent = 'SCENES';
  grid.appendChild(corner);
  for (const t of tracks) {
    const th = document.createElement('div');
    th.className = 'ss-thead';
    th.style.setProperty('--hue', String(trackHue(t.id)));
    th.textContent = t.name;
    grid.appendChild(th);
  }

  // Une ligne par scene
  for (const sc of scenes) {
    // pistes ayant un slot dans cette scene (pour lancer/arreter la scene)
    const sceneTrackIds = tracks
      .filter((t) => (t.clips ?? []).some((c) => c.sceneId === sc.id))
      .map((t) => t.id);
    const sceneOn = sceneTrackIds.some((tid) => playing.has(slotKey(sc.id, tid)));
    const launch = document.createElement('button');
    launch.className = 'ss-scene' + (sceneOn ? ' playing' : '');
    launch.textContent = sc.name;
    launch.title = sceneOn ? 'Arreter la scene' : 'Lancer la scene';
    launch.disabled = sceneTrackIds.length === 0;
    launch.addEventListener('click', () => toggleScene(sc.id, sceneTrackIds));
    grid.appendChild(launch);
    for (const t of tracks) {
      const clip = (t.clips ?? []).find((c) => c.sceneId === sc.id);
      const isPlaying = playing.has(slotKey(sc.id, t.id));
      const cell = document.createElement('button');
      cell.className = 'ss-slot' + (clip ? ' filled' : '') + (isPlaying ? ' playing' : '');
      cell.style.setProperty('--hue', String(trackHue(t.id)));
      if (clip) {
        const nn = clip.notes?.length ?? 0;
        const icon = isPlaying ? '&#9632;' : '&#9654;';  // stop / play
        cell.innerHTML = `<span class="ss-play">${icon}</span><span class="ss-nm">${nn} notes</span>`;
        cell.title = isPlaying ? 'Arreter le slot' : 'Lancer le slot';
        cell.addEventListener('click', () => {
          ctx.selectedTrackId = t.id;
          toggleSlot(sc.id, t.id);   // lance/arrete + re-render
          renderTracks(true);        // fait apparaitre le clip au piano-roll (rack)
        });
      } else {
        cell.innerHTML = '<span class="ss-add">+</span>';
        cell.addEventListener('click', () => {
          ctx.project!.addSessionClip(t.id, sc.id);
          ctx.selectedTrackId = t.id;
          sendLastChange();
          renderSession();
          renderTracks(true);
        });
      }
      grid.appendChild(cell);
    }
  }
  slot.appendChild(grid);

  // Pied : ajouter une scene
  const foot = document.createElement('div');
  foot.className = 'session-foot';
  const addSc = document.createElement('button');
  addSc.className = 'ss-addscene';
  addSc.textContent = '+ scene';
  addSc.addEventListener('click', () => {
    ctx.project!.addScene(`Scene ${scenes.length + 1}`);
    sendLastChange();
    renderSession();
  });
  foot.appendChild(addSc);
  slot.appendChild(foot);
}
