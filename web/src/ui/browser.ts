// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Rail navigateur (Refonte T4) : le catalogue de plugins, a gauche. Onglets
 * Instruments / Effets / Samples, alimentes par window.__dawPlugins (le
 * catalogue que le moteur envoie apres le scan) et par ctx.library (les
 * samples du projet). Clic sur un instrument/effet = ajoute le device a la
 * piste selectionnee (reutilise project.addProcessor). L'onglet Samples
 * monte la palette existante (arm/place inchange) : SOURCE UNIQUE des
 * samples (F6 - la barre KIT de l'arrangement est retiree).
 */

import { ctx } from '../app/context';
// D3 : le rail est la SOURCE des drags ; les cibles (pistes, zone vide) et
// la pose vivent dans placement.ts. Cycle d'import placement<->browser
// assume : chaque module n'appelle l'autre qu'a l'execution, jamais a l'eval.
import { DND_MIME, installBrowserDnd, decorateSampleChips,
         addDeviceToTrack, type BrowserDragPayload } from '../app/placement';

type Cat = { uid: string; name: string; vendor: string; subCategories: string };
const isInst = (e: Cat) =>
  e.subCategories.includes('Instrument') || e.subCategories.includes('Synth');

let tab: 'inst' | 'fx' | 'samples' = 'inst';

export function renderBrowser(): void {
  const slot = document.getElementById('browser-slot');
  if (!slot) return;
  installBrowserDnd();  // D3 : cibles de drop sur #tracks (idempotent)
  const cat = ((window as unknown as { __dawPlugins?: Cat[] }).__dawPlugins) ?? [];
  const inst = cat.filter(isInst).sort((a, b) => a.name.localeCompare(b.name));
  const fx = cat.filter((e) => e.subCategories.includes('Fx') && !isInst(e))
    .sort((a, b) => a.name.localeCompare(b.name));

  const nSamples = ctx.library?.count ?? 0;

  slot.replaceChildren();
  const head = document.createElement('div');
  head.className = 'browser-head';
  for (const [key, label, n] of [['inst', 'Instruments', inst.length],
                                 ['fx', 'Effets', fx.length],
                                 ['samples', 'Samples', nSamples]] as const) {
    const t = document.createElement('button');
    t.className = 'browser-tab' + (tab === key ? ' on' : '');
    t.textContent = `${label} ${n}`;
    t.addEventListener('click', () => { tab = key as typeof tab; renderBrowser(); });
    head.appendChild(t);
  }
  slot.appendChild(head);

  const list = document.createElement('div');
  list.className = 'browser-list';

  // F6 : onglet Samples = la palette du projet (arm/place inchange). On
  // remonte l'element existant de ctx.library (source unique des samples).
  if (tab === 'samples') {
    if (ctx.library) {
      list.appendChild(ctx.library.element);
      // D3 : vrai drag vers une lane EN PLUS du clic arme (qui reste tel
      // quel) - decoration idempotente, la Library n'est pas modifiee.
      decorateSampleChips(ctx.library.element);
    } else {
      const empty = document.createElement('div');
      empty.className = 'browser-empty';
      empty.textContent = 'depose un WAV sur une piste pour commencer';
      list.appendChild(empty);
    }
    slot.appendChild(list);
    return;
  }

  const items = tab === 'inst' ? inst : fx;
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'browser-empty';
    empty.textContent = cat.length === 0
      ? 'catalogue vide (moteur en scan…)' : 'aucun';
    list.appendChild(empty);
  }
  for (const e of items) {
    const it = document.createElement('button');
    it.className = 'browser-item';
    it.dataset.uid = e.uid;
    const ic = document.createElement('span');
    ic.className = 'bi-ic ' + (tab === 'inst' ? 'inst' : 'fx');
    ic.textContent = tab === 'inst' ? '◈' : '∿';
    const nm = document.createElement('span');
    nm.className = 'bi-name';
    nm.textContent = e.name;
    const vd = document.createElement('span');
    vd.className = 'bi-vendor';
    vd.textContent = e.vendor;
    it.append(ic, nm, vd);
    it.title = `Ajouter ${e.name} a la piste selectionnee`;
    // D3 : vrai drag vers une piste (drop = addProcessor sur CETTE piste)
    // ou vers la zone vide (= nouvelle piste + device). Le clic simple
    // ci-dessous garde son comportement (piste SELECTIONNEE).
    it.draggable = true;
    it.addEventListener('dragstart', (ev) => {
      const payload: BrowserDragPayload = {
        kind: tab === 'inst' ? 'instrument' : 'effect',
        uid: e.uid, name: e.name,
      };
      ev.dataTransfer?.setData(DND_MIME, JSON.stringify(payload));
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
    });
    it.addEventListener('click', () => {
      if (!ctx.project || !ctx.selectedTrackId) return;
      // Pistes typees : le clic passe par la meme garde que le drop
      // (instrument sur piste audio = refus visible), fabrique unique.
      addDeviceToTrack({ kind: tab === 'inst' ? 'instrument' : 'effect',
        uid: e.uid, name: e.name }, ctx.selectedTrackId);
    });
    list.appendChild(it);
  }
  slot.appendChild(list);
}
