// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * F7 : splitters redimensionnables de l'etabli. Fondation de l'interface
 * dockable ("a terme faudra pouvoir drag and drop... et modder soi-meme").
 *
 * 2026-08-26 (rack en bas facon Ableton) : deux AXES - 'browser' est une
 * LARGEUR de colonne (drag horizontal), 'device' est une HAUTEUR de panneau
 * bas (drag vertical, panneau ancre en bas -> monter l'agrandit). L'ancien
 * splitter 'rack' (colonne droite) a disparu avec la colonne.
 *
 * Les dimensions sont une PRESENTATION LOCALE (cf. principe presentation =
 * locale, donnees = partagees) : CSS vars --col-browser / --row-device
 * posees sur le BODY (les deux conteneurs y vivent), persistees en
 * localStorage, jamais dans le doc. La cle 'daw-col-widths' est conservee
 * (les vieux stockages {browser, rack} donnent leur browser, rack est
 * simplement ignore).
 */

const KEY = 'daw-col-widths';
const DEFAULTS = { browser: 208, device: 260 };
const LIMITS = { browser: [140, 520], device: [140, 560] } as const;

type Which = keyof typeof DEFAULTS;

function clampDim(which: Which, px: number): number {
  const [lo, hi] = LIMITS[which];
  return Math.max(lo, Math.min(hi, px));
}

function load(): Record<Which, number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Record<Which, number>>;
      return {
        browser: clampDim('browser', v.browser ?? DEFAULTS.browser),
        device: clampDim('device', v.device ?? DEFAULTS.device),
      };
    }
  } catch { /* private mode / corrupt : defauts */ }
  return { ...DEFAULTS };
}

function save(w: Record<Which, number>): void {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* ignore */ }
}

export function initSplitters(): void {
  const host = document.body;
  const dims = load();
  const apply = (): void => {
    host.style.setProperty('--col-browser', `${dims.browser}px`);
    host.style.setProperty('--row-device', `${dims.device}px`);
  };
  apply();

  for (const el of host.querySelectorAll<HTMLElement>('.col-split')) {
    const which = el.dataset.split as Which;
    if (which !== 'browser' && which !== 'device') continue;
    const vertical = which === 'device';  // drag sur Y, panneau ancre en bas

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const start = vertical ? e.clientY : e.clientX;
      const startDim = dims[which];
      const onMove = (ev: PointerEvent): void => {
        const d = (vertical ? ev.clientY : ev.clientX) - start;
        // panneau bas ancre en BAS : glisser vers le haut l'agrandit
        dims[which] = clampDim(which, startDim + (vertical ? -d : d));
        apply();
      };
      const onUp = (ev: PointerEvent): void => {
        el.classList.remove('dragging');
        try { el.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        save(dims);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });

    // clavier : fleches (10px, l'axe suit l'orientation), Entree = defaut
    el.addEventListener('keydown', (e) => {
      let d = 0;
      if (vertical) {
        if (e.key === 'ArrowUp') d = 10;        // agrandir le panneau
        else if (e.key === 'ArrowDown') d = -10;
      } else {
        if (e.key === 'ArrowRight') d = 10;
        else if (e.key === 'ArrowLeft') d = -10;
      }
      if (d === 0) {
        if (e.key === 'Enter' || e.key === ' ') {
          dims[which] = DEFAULTS[which];
          apply(); save(dims); e.preventDefault();
        }
        return;
      }
      dims[which] = clampDim(which, dims[which] + d);
      apply(); save(dims);
      e.preventDefault();
    });
    el.addEventListener('dblclick', () => {
      dims[which] = DEFAULTS[which];
      apply(); save(dims);
    });
  }
}
