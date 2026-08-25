// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Rail navigateur (Refonte T4) : le catalogue de plugins, a gauche. Onglets
 * Instruments / Effets, alimentes par window.__dawPlugins (le catalogue que
 * le moteur envoie apres le scan). Clic sur un item = ajoute le device a la
 * piste selectionnee (reutilise project.addProcessor, le meme chemin que
 * "+ device"). Les samples restent pour l'instant dans la barre KIT.
 */

import { ctx, sendLastChange } from '../app/context';
import { renderTracks } from '../app/render';

type Cat = { uid: string; name: string; vendor: string; subCategories: string };
const isInst = (e: Cat) =>
  e.subCategories.includes('Instrument') || e.subCategories.includes('Synth');

let tab: 'inst' | 'fx' = 'inst';

export function renderBrowser(): void {
  const slot = document.getElementById('browser-slot');
  if (!slot) return;
  const cat = ((window as unknown as { __dawPlugins?: Cat[] }).__dawPlugins) ?? [];
  const inst = cat.filter(isInst).sort((a, b) => a.name.localeCompare(b.name));
  const fx = cat.filter((e) => e.subCategories.includes('Fx') && !isInst(e))
    .sort((a, b) => a.name.localeCompare(b.name));

  slot.replaceChildren();
  const head = document.createElement('div');
  head.className = 'browser-head';
  for (const [key, label, n] of [['inst', 'Instruments', inst.length],
                                 ['fx', 'Effets', fx.length]] as const) {
    const t = document.createElement('button');
    t.className = 'browser-tab' + (tab === key ? ' on' : '');
    t.textContent = `${label} ${n}`;
    t.addEventListener('click', () => { tab = key as typeof tab; renderBrowser(); });
    head.appendChild(t);
  }
  slot.appendChild(head);

  const list = document.createElement('div');
  list.className = 'browser-list';
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
    it.addEventListener('click', () => {
      if (!ctx.project || !ctx.selectedTrackId) return;
      ctx.project.addProcessor(ctx.selectedTrackId, {
        id: 'proc-' + Math.random().toString(36).slice(2, 10),
        type: 'vst3', uid: e.uid, name: e.name, params: [],
      } as never);
      sendLastChange();
      renderTracks(true);
    });
    list.appendChild(it);
  }
  slot.appendChild(list);
}
