// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A1 automation - evaluation PURE d'une enveloppe (AUTOMATION-DESIGN.md).
 *
 * Module separe de project.ts (regle SPLITTER) : cette fonction est le
 * contrat d'exactitude que le moteur (tranche A2) devra reproduire en
 * C++ - la garder pure et sans dependance Automerge permet de la tester
 * seule et de comparer les deux implementations point a point.
 */

import type { AutomationLaneDef } from './schema';

/**
 * Valeur de l'enveloppe a l'instant t (samples timeline).
 *
 * - null si la lane est disabled ou vide : le CONSOMMATEUR retombe sur
 *   l'etat manuel (priorite lane enabled > manuel, design section 2) -
 *   null dit "pas d'automation", jamais "valeur 0".
 * - Clamp aux extremites : avant le premier point on tient sa valeur,
 *   apres le dernier on tient la sienne (pas d'extrapolation).
 * - Interpolation LINEAIRE entre points (v1 - shape viendra plus tard).
 *
 * Precondition : points TRIES par t (invariant d'ecriture des mutateurs
 * de project.ts). Deux points confondus en t (possible apres merge de
 * pairs) : pas de pente calculable, on rend le second - le plus recent
 * dans l'ordre du tri stable - plutot que diviser par zero.
 */
export function automationValueAt(lane: AutomationLaneDef, t: number): number | null {
  if (!lane.enabled) return null;
  const pts = lane.points;
  if (pts.length === 0) return null;
  if (t <= pts[0].t) return pts[0].v;
  const last = pts[pts.length - 1];
  if (t >= last.t) return last.v;
  // Balayage lineaire : les lanes v1 portent quelques dizaines de points
  // au plus, et le moteur evaluera par sous-bloc avec son propre curseur.
  for (let i = 1; i < pts.length; ++i) {
    if (t < pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      const dt = b.t - a.t;
      if (dt <= 0) return b.v;  // points confondus : voir docstring
      return a.v + (b.v - a.v) * ((t - a.t) / dt);
    }
  }
  return last.v;  // unreachable avec des points tries (garde de forme)
}
