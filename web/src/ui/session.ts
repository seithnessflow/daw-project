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
    const launch = document.createElement('button');
    launch.className = 'ss-scene';
    launch.textContent = sc.name;
    launch.title = 'Lancer la scene (T7b)';
    grid.appendChild(launch);
    for (const t of tracks) {
      const clip = (t.clips ?? []).find((c) => c.sceneId === sc.id);
      const cell = document.createElement('button');
      cell.className = 'ss-slot' + (clip ? ' filled' : '');
      cell.style.setProperty('--hue', String(trackHue(t.id)));
      if (clip) {
        const nn = clip.notes?.length ?? 0;
        cell.innerHTML = `<span class="ss-play">&#9654;</span><span class="ss-nm">${nn} notes</span>`;
        cell.addEventListener('click', () => {
          ctx.selectedTrackId = t.id;
          renderTracks(true);  // fait apparaitre le clip au piano-roll (rack)
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
