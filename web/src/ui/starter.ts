// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The starter screen (2026-08-22): first contact on an empty product
 * project offers a choice - load a demo groove, or start empty. Chosen
 * on screen (user decision), not by a launch flag. Interactive UI with
 * contracts (data-role), NOT the read-only life layer.
 *
 * The demo places clips from KNOWN kit hashes (web/public/demo.json);
 * the launcher guarantees those assets are in the store, so it sounds.
 */

import type { Project } from '../document/project';
import { newId } from '../document/ids';

interface DemoTrack {
  name: string;
  hash: string;
  seconds: number;
  times: number[];
}
interface DemoManifest {
  sampleRate: number;
  tracks: DemoTrack[];
}

/**
 * Mount the starter overlay if the (product) project is empty. Returns
 * nothing; wires its own buttons. `onSeed` is called after a demo/empty
 * choice so the app can re-render + push.
 */
export function mountStarter(
  slot: HTMLElement,
  project: Project,
  pushLast: () => void,   // send project.getLastChange() after EACH mutation
  afterChoice: () => void,
): void {
  const doc = project.getDocument();
  const hasClips = doc.tracks.some((t) => t.clips.length > 0);
  if (hasClips) return; // material already present: no starter

  const overlay = document.createElement('div');
  overlay.className = 'starter';
  overlay.id = 'starter';

  const card = document.createElement('div');
  card.className = 'starter-card';
  const title = document.createElement('div');
  title.className = 'starter-title';
  title.textContent = 'Magic Potion';
  const sub = document.createElement('div');
  sub.className = 'starter-sub';
  sub.textContent = 'Commence par un demo, ou pars d’une page blanche.';
  card.append(title, sub);

  const demoBtn = document.createElement('button');
  demoBtn.className = 'starter-btn starter-btn-primary';
  demoBtn.dataset.role = 'starter-demo';
  demoBtn.textContent = '▶  Charger un demo';
  demoBtn.addEventListener('click', () => {
    void loadDemo(project, pushLast).then(() => {
      overlay.remove();
      afterChoice();
    });
  });

  const emptyBtn = document.createElement('button');
  emptyBtn.className = 'starter-btn';
  emptyBtn.dataset.role = 'starter-empty';
  emptyBtn.textContent = 'Partir vierge';
  emptyBtn.addEventListener('click', () => {
    overlay.remove();
    afterChoice();
  });

  card.append(demoBtn, emptyBtn);
  overlay.appendChild(card);
  slot.appendChild(overlay);
}

/** Seed the demo groove into the document (reuses seed tracks, adds the
 *  rest); pushes through the normal change path via afterChoice. */
async function loadDemo(project: Project, pushLast: () => void): Promise<void> {
  let manifest: DemoManifest;
  try {
    const res = await fetch('/demo.json');
    manifest = await res.json() as DemoManifest;
  } catch {
    console.error('demo.json unavailable - staying empty');
    return;
  }
  const sr = project.getDocument().sampleRate || manifest.sampleRate || 48000;
  const existing = project.getDocument().tracks.map((t) => t.id);

  manifest.tracks.forEach((dt, i) => {
    let trackId = existing[i];
    if (!trackId) {
      trackId = newId('track');
      project.addTrack({ id: trackId, name: dt.name, gain: 1.0, clips: [], chain: [] });
      pushLast();  // every mutation reaches the server (getLastChange is scalar)
    }
    dt.times.forEach((sec) => {
      project.addClip(trackId, {
        id: newId('clip', dt.name),
        assetHash: dt.hash,
        startSample: Math.round(sec * sr),
        lengthSamples: Math.round(dt.seconds * sr),
        offsetSamples: 0,
      });
      pushLast();
    });
  });
}
