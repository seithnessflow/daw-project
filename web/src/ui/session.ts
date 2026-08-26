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
import { orderedTracks } from '../document/schema';

// F5 : etat "en lecture" des slots - optimiste local, RECONCILIE par la
// verite moteur (telemetrie SessionState, F5+) quand un moteur est la.
// Cle = `${sceneId}::${trackId}`. Persiste entre les rendus.
const playing = new Set<string>();
// F5+ : slots EN FILE (lances, en attente de leur quantum) - verite moteur.
const queued = new Set<string>();
const slotKey = (sceneId: string, trackId: string): string => `${sceneId}::${trackId}`;

// F5+ : launch QUANTISE (prochaine frontiere du quantum pose par l'ancre).
// Preference de presentation locale, ON par defaut.
let quantize = localStorage.getItem('daw-session-quantize') !== '0';

/**
 * F5+ : la VERITE des slots, depuis la telemetrie moteur (30 Hz). Remplace
 * l'etat optimiste ; re-rend uniquement si quelque chose a change (30 Hz de
 * replaceChildren sinon). Liste vide = tout arrete.
 */
export function applySessionState(
  slots: Array<{ trackId: string; sceneId: string; queued: boolean }>): void {
  const nextPlaying = new Set<string>();
  const nextQueued = new Set<string>();
  for (const s of slots) {
    (s.queued ? nextQueued : nextPlaying).add(slotKey(s.sceneId, s.trackId));
  }
  const same = (a: Set<string>, b: Set<string>) =>
    a.size === b.size && [...a].every((k) => b.has(k));
  if (same(nextPlaying, playing) && same(nextQueued, queued)) return;
  playing.clear(); nextPlaying.forEach((k) => playing.add(k));
  queued.clear(); nextQueued.forEach((k) => queued.add(k));
  renderSession();
}

/** Lance/arrete un slot (moteur) et met a jour l'etat visuel local. */
function toggleSlot(sceneId: string, trackId: string): void {
  const key = slotKey(sceneId, trackId);
  const on = !(playing.has(key) || queued.has(key));
  if (on) playing.add(key); else { playing.delete(key); queued.delete(key); }
  // stop cible LA scene du slot (F5+ : le moteur filtre par scene)
  ctx.engineClient?.sessionLaunch(sceneId, trackId, !on, quantize);
  renderSession();
}

/** Lance/arrete toute une scene (toutes les pistes qui ont un slot). */
function toggleScene(sceneId: string, trackIds: string[]): void {
  // si au moins un slot de la scene joue -> on arrete tout, sinon on lance tout
  const anyOn = trackIds.some((t) =>
    playing.has(slotKey(sceneId, t)) || queued.has(slotKey(sceneId, t)));
  const stop = anyOn;
  for (const t of trackIds) {
    const key = slotKey(sceneId, t);
    if (stop) { playing.delete(key); queued.delete(key); } else playing.add(key);
  }
  ctx.engineClient?.sessionLaunch(sceneId, '', stop, quantize);
  renderSession();
}

/** F5+ : STOP ALL - arrete tous les slots, toutes scenes confondues. */
function stopAll(): void {
  playing.clear();
  queued.clear();
  ctx.engineClient?.sessionLaunch('', '', true);
  renderSession();
}

export function renderSession(): void {
  const slot = document.getElementById('session-slot');
  if (!slot || !ctx.project) return;
  const doc = ctx.project.getDocument();
  // D1 : les colonnes suivent l'ordre d'AFFICHAGE (source unique)
  const tracks = orderedTracks(doc);
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
    const sceneOn = sceneTrackIds.some((tid) =>
      playing.has(slotKey(sc.id, tid)) || queued.has(slotKey(sc.id, tid)));
    const launch = document.createElement('button');
    launch.className = 'ss-scene' + (sceneOn ? ' playing' : '');
    launch.dataset.ssSceneBtn = sc.id;  // clic droit contextuel (F5+)
    launch.textContent = sc.name;
    launch.title = sceneOn ? 'Arreter la scene' : 'Lancer la scene';
    launch.disabled = sceneTrackIds.length === 0;
    launch.addEventListener('click', () => toggleScene(sc.id, sceneTrackIds));
    grid.appendChild(launch);
    for (const t of tracks) {
      const clip = (t.clips ?? []).find((c) => c.sceneId === sc.id);
      const isQueued = queued.has(slotKey(sc.id, t.id));
      const isPlaying = playing.has(slotKey(sc.id, t.id)) || isQueued;
      const cell = document.createElement('button');
      cell.className = 'ss-slot' + (clip ? ' filled' : '') +
        (isPlaying ? ' playing' : '') + (isQueued ? ' queued' : '');
      cell.style.setProperty('--hue', String(trackHue(t.id)));
      cell.dataset.ssTrack = t.id;          // clic droit contextuel
      cell.dataset.ssScene = sc.id;
      if (clip) cell.dataset.ssClip = clip.id;
      if (clip) {
        const nn = clip.notes?.length ?? 0;
        const icon = isPlaying ? '&#9632;' : '&#9654;';  // stop / play
        cell.innerHTML = `<span class="ss-play">${icon}</span><span class="ss-nm">${nn} notes</span>`;
        cell.title = isQueued ? 'En file (prochain quantum) - cliquer pour annuler'
          : isPlaying ? 'Arreter le slot' : 'Lancer le slot';
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

  // Pied : ajouter une scene + F5+ (quantize, stop all)
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

  // F5+ : launch quantise (Q) - preference locale, ON par defaut
  const qBtn = document.createElement('button');
  qBtn.className = 'ss-quantize';
  qBtn.textContent = 'Q';
  qBtn.setAttribute('aria-pressed', quantize ? 'true' : 'false');
  qBtn.title = quantize
    ? 'Launch quantise (prochaine frontiere du quantum de l\'ancre) - actif'
    : 'Launch quantise - inactif (lancement immediat)';
  qBtn.addEventListener('click', () => {
    quantize = !quantize;
    localStorage.setItem('daw-session-quantize', quantize ? '1' : '0');
    renderSession();
  });
  foot.appendChild(qBtn);

  // F5+ : STOP ALL - toutes scenes confondues
  const stopBtn = document.createElement('button');
  stopBtn.className = 'ss-stopall';
  stopBtn.innerHTML = '&#9632; stop all';
  stopBtn.title = 'Arreter tous les slots (toutes scenes)';
  stopBtn.addEventListener('click', stopAll);
  foot.appendChild(stopBtn);

  slot.appendChild(foot);
}
