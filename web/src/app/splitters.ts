// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * F7 : splitters redimensionnables entre les 3 colonnes de l'etabli
 * (browser | arrangement | rack). Fondation de l'interface dockable
 * ("a terme faudra pouvoir drag and drop... et modder soi-meme").
 *
 * Les largeurs sont une PRESENTATION LOCALE (cf. principe presentation =
 * locale, donnees = partagees) : dans les CSS vars --col-browser /
 * --col-rack de .workspace, persistees en localStorage, jamais dans le doc.
 * Le splitter "browser" pousse la colonne gauche ; le splitter "rack" pousse
 * la colonne droite (ancree a droite -> on soustrait le deplacement).
 */

const KEY = 'daw-col-widths';
const DEFAULTS = { browser: 208, rack: 340 };
const LIMITS = { browser: [140, 520], rack: [220, 680] } as const;

function clampWidth(which: 'browser' | 'rack', px: number): number {
  const [lo, hi] = LIMITS[which];
  return Math.max(lo, Math.min(hi, px));
}

function load(): { browser: number; rack: number } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<{ browser: number; rack: number }>;
      return {
        browser: clampWidth('browser', v.browser ?? DEFAULTS.browser),
        rack: clampWidth('rack', v.rack ?? DEFAULTS.rack),
      };
    }
  } catch { /* private mode / corrupt : defauts */ }
  return { ...DEFAULTS };
}

function save(w: { browser: number; rack: number }): void {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* ignore */ }
}

export function initSplitters(): void {
  const ws = document.querySelector<HTMLElement>('.workspace');
  if (!ws) return;
  const widths = load();
  const apply = (): void => {
    ws.style.setProperty('--col-browser', `${widths.browser}px`);
    ws.style.setProperty('--col-rack', `${widths.rack}px`);
  };
  apply();

  for (const el of ws.parentElement!.querySelectorAll<HTMLElement>('.col-split')) {
    const which = el.dataset.split as 'browser' | 'rack';
    if (which !== 'browser' && which !== 'rack') continue;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const startX = e.clientX;
      const startW = widths[which];
      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        // rack est ancre a DROITE : glisser vers la gauche l'agrandit
        widths[which] = clampWidth(which, startW + (which === 'rack' ? -dx : dx));
        apply();
      };
      const onUp = (ev: PointerEvent): void => {
        el.classList.remove('dragging');
        try { el.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        save(widths);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });

    // clavier : fleches (10px), double-clic / Entree = defaut
    el.addEventListener('keydown', (e) => {
      let d = 0;
      if (e.key === 'ArrowLeft') d = which === 'rack' ? 10 : -10;
      else if (e.key === 'ArrowRight') d = which === 'rack' ? -10 : 10;
      else if (e.key === 'Enter' || e.key === ' ') { widths[which] = DEFAULTS[which]; apply(); save(widths); e.preventDefault(); return; }
      else return;
      widths[which] = clampWidth(which, widths[which] + d);
      apply(); save(widths);
      e.preventDefault();
    });
    el.addEventListener('dblclick', () => {
      widths[which] = DEFAULTS[which];
      apply(); save(widths);
    });
  }
}
