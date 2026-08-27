// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Piano-roll minimal (v8 MIDI). Une grille pitch (lignes) x pas de temps
 * (colonnes) pour UN clip MIDI ; cliquer une case pose/enleve une note. Les
 * notes vivent dans le document (project.toggleNote) et se synchronisent
 * comme tout le reste ; l'instrument en tete de chaine de la piste les joue.
 *
 * Volontairement simple (grille a pas fixes) - l'edition libre (durees,
 * velocite, glisser) viendra ; ici on prouve la boucle note -> son.
 */

import type { Project } from '../document/project';
import type { ClipDef, NoteDef } from '../document/schema';
import { isMusicalClip } from '../document/schema';

const STEPS = 16;                 // subdivisions temporelles du clip
const LOW = 48;                   // do3
const HIGH = 72;                  // do5 (inclus)
const NAMES =['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = (p: number) => NAMES[p % 12].includes('#');

/**
 * Rend le piano-roll d'un clip dans `container`. `onChange` est appele apres
 * chaque edition (pour pousser le changement au reseau + re-rendre).
 */
export function renderPianoRoll(
  container: HTMLElement,
  project: Project,
  trackId: string,
  clip: ClipDef,
  onChange: () => void,
): void {
  container.replaceChildren();
  container.className = 'piano-roll';
  // T3 : un clip MUSICAL edite en TICKS (clip d'1 mesure : 3840/16 =
  // 240 ticks = la double-croche), un clip absolu en samples - le
  // domaine du clip parent gouverne ses notes (jamais un mix).
  const musical = isMusicalClip(clip) && typeof clip.lengthTick === 'number';
  const stepLen = musical
    ? Math.max(1, Math.floor(clip.lengthTick! / STEPS))
    : Math.max(1, Math.floor((clip.lengthSamples ?? 0) / STEPS));
  const notes = clip.notes ?? [];
  const has = (pitch: number, start: number) =>
    notes.some((n) => n.pitch === pitch &&
      (musical ? n.startTick === start : n.startSample === start));

  const grid = document.createElement('div');
  grid.className = 'pr-grid';
  grid.style.setProperty('--steps', String(STEPS));

  // Haut = aigu : on parcourt les pitches du plus haut au plus bas.
  for (let p = HIGH; p >= LOW; p--) {
    const label = document.createElement('div');
    label.className = 'pr-key' + (isBlack(p) ? ' pr-black' : '');
    label.textContent = p % 12 === 0 ? `${NAMES[0]}${Math.floor(p / 12) - 1}` : '';
    grid.appendChild(label);
    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement('button');
      cell.className = 'pr-cell'
        + (isBlack(p) ? ' pr-row-black' : '')
        + (s % 4 === 0 ? ' pr-beat' : '');
      const start = s * stepLen;
      if (has(p, start)) cell.classList.add('pr-on');
      // Outillage de pilotage (compo 2026-08-27) : adresser une cellule
      // par donnees, pas par geometrie - le meme contrat que les specs.
      cell.dataset.pitch = String(p);
      cell.dataset.step = String(s);
      cell.setAttribute('aria-label', `${NAMES[p % 12]}${Math.floor(p / 12) - 1} pas ${s + 1}`);
      cell.addEventListener('click', () => {
        const note: NoteDef = musical
          ? { pitch: p, velocity: 100, startTick: start, lengthTick: stepLen }
          : { pitch: p, velocity: 100, startSample: start, lengthSamples: stepLen };
        project.toggleNote(trackId, clip.id, note);
        onChange();
      });
      grid.appendChild(cell);
    }
  }
  container.appendChild(grid);
}
