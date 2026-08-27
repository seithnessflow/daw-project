// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A3 : l'UI des ENVELOPPES (AUTOMATION-DESIGN section 3). Une lane
 * repliable SOUS les clips de chaque piste : selecteur de cible (gain /
 * pan - les params de device attendent A4 cote moteur), courbe SVG,
 * points a la souris. Le document (A1) et le moteur (A2) existent deja :
 * ce module ne fait QUE dessiner et appeler les mutateurs journalises.
 *
 * Gestes (regle gravee des poignees - chaque geste a sa branche) :
 *  - double-clic sur la courbe : AJOUTER un point (cree la lane au
 *    premier geste si absente - un seul groupe d'undo) ;
 *  - drag d'un point : le DEPLACER (un groupe d'undo par geste ; l'index
 *    du point est retrouve par sa valeur (t,v) courante - le tri peut le
 *    faire changer d'index en traversant un voisin) ;
 *  - clic droit sur un point : le SUPPRIMER ;
 *  - clic droit sur la lane : menu (activer/bypass, supprimer la lane).
 *
 * Etat de PRESENTATION locale (jamais le doc) : quelles pistes montrent
 * leur lane + la cible choisie par piste. Le rendu est appele en fin de
 * renderTracks et decore les .track existants (aucun couplage au diff).
 */

import { ctx, els, sendLastChange } from '../app/context';
import { renderTracks } from '../app/render';
import { showContextMenu } from './context_menu';
import { TIMELINE } from './track';
import { cssId } from '../document/sanitize';
import type { AutomationLaneDef, TrackDef, ProjectDef } from '../document/schema';
import { clipEndSamples } from '../document/geometry';

const LANE_H = 56;
const PAD = 6;

/** Pistes dont la lane est OUVERTE + cible choisie (presentation locale). */
const openLanes = new Map<string, 'gain' | 'pan'>();

export function toggleAutomationLane(trackId: string): void {
  if (openLanes.has(trackId)) openLanes.delete(trackId);
  else openLanes.set(trackId, 'gain');
  renderTracks(true);
}

export function isAutomationOpen(trackId: string): boolean {
  return openLanes.has(trackId);
}

/** La lane du doc pour (piste, cible) - ou null. */
function laneFor(track: TrackDef, param: string): AutomationLaneDef | null {
  return (track.automation ?? [])
    .find((l) => !l.target.processorId && l.target.param === param) ?? null;
}

/** Meme clamp que les mutateurs (project.ts) : retrouver un point par sa
 *  valeur ECRITE exige d'ecrire exactement ce qu'ils ecrivent. */
const clampT = (t: number): number => Math.max(0, Math.round(t));
const clampV = (v: number): number => Math.max(0, Math.min(1, v));

function xOf(t: number, sr: number): number {
  return (t / sr) * TIMELINE.pps;
}
function tOf(x: number, sr: number): number {
  return clampT((x / TIMELINE.pps) * sr);
}
function vOf(y: number): number {
  return clampV(1 - (y - PAD) / (LANE_H - 2 * PAD));
}
function yOf(v: number): number {
  return PAD + (1 - v) * (LANE_H - 2 * PAD);
}

/**
 * Rend (ou retire) la rangee d'automation de chaque .track affiche.
 * Appele en fin de renderTracks - idempotent, s'appuie sur data-track-id.
 */
export function renderAutomationLanes(): void {
  if (!ctx.project) return;
  const doc = ctx.project.getDocument();
  const sr = doc.sampleRate || 48000;

  for (const trackEl of els.tracks.querySelectorAll<HTMLElement>('.track[data-track-id]')) {
    const trackId = trackEl.getAttribute('data-track-id')!;
    // La row est une SOEUR de la .track (inseree juste apres), pas un
    // enfant : .track est une RANGEE flex (tete | lane) - un enfant de
    // plus partait a droite de la lane, hors ecran (x=1452 vu en sonde).
    const existing = els.tracks.querySelector<HTMLElement>(
      `.automation-row[data-auto-track="${cssId(trackId)}"]`);
    const param = openLanes.get(trackId);
    if (!param) {
      existing?.remove();
      continue;
    }
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) { existing?.remove(); continue; }

    existing?.remove();  // reconstruire (les points ont pu bouger/merger)
    trackEl.insertAdjacentElement('afterend', buildRow(track, doc, param, sr));
  }
}

function buildRow(track: TrackDef, doc: ProjectDef,
  param: 'gain' | 'pan', sr: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'automation-row';
  row.dataset.autoTrack = track.id;

  // ---- Tete : cible + etat de la lane -----------------------------------
  const head = document.createElement('div');
  head.className = 'automation-head';
  const sel = document.createElement('select');
  sel.className = 'automation-target';
  sel.setAttribute('aria-label', 'Cible de l\'enveloppe');
  for (const p of ['gain', 'pan'] as const) {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p === 'gain' ? 'Volume (gain)' : 'Pan';
    if (p === param) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    openLanes.set(track.id, sel.value as 'gain' | 'pan');
    renderTracks(true);
  });
  head.appendChild(sel);

  const lane = laneFor(track, param);
  const onOff = document.createElement('button');
  onOff.className = 'automation-enable';
  onOff.setAttribute('aria-pressed', lane?.enabled ? 'true' : 'false');
  onOff.textContent = lane?.enabled ? 'ON' : 'off';
  onOff.title = lane
    ? (lane.enabled ? 'Enveloppe active (le manuel est pilote)' : 'Enveloppe en bypass')
    : 'Pas encore d\'enveloppe (double-clic sur la courbe pour poser un point)';
  onOff.disabled = !lane;
  onOff.addEventListener('click', () => {
    if (!ctx.project || !lane) return;
    ctx.project.setAutomationLaneEnabled(track.id, lane.id, !lane.enabled);
    sendLastChange();
    renderTracks(true);
  });
  head.appendChild(onOff);
  row.appendChild(head);

  // ---- La courbe (SVG, meme echelle que la timeline) --------------------
  const laneWidth = Math.max(600, xOf(
    Math.max(48000 * 12,
      ...track.clips.map((c) => clipEndSamples(c, doc))), sr));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('automation-svg');
  svg.setAttribute('width', String(laneWidth));
  svg.setAttribute('height', String(LANE_H));

  const pts = lane?.points ?? [];
  if (pts.length > 0) {
    // clamp aux extremites : la valeur TIENT avant le premier et apres le
    // dernier point (le miroir exact de automationValueAt)
    const d = [
      `M 0 ${yOf(pts[0].v)}`,
      `L ${xOf(pts[0].t, sr)} ${yOf(pts[0].v)}`,
      ...pts.slice(1).map((p) => `L ${xOf(p.t, sr)} ${yOf(p.v)}`),
      `L ${laneWidth} ${yOf(pts[pts.length - 1].v)}`,
    ].join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.classList.add('automation-curve');
    if (lane && !lane.enabled) path.classList.add('bypassed');
    svg.appendChild(path);
  }
  pts.forEach((p, i) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(xOf(p.t, sr)));
    c.setAttribute('cy', String(yOf(p.v)));
    c.setAttribute('r', '5');
    c.classList.add('automation-point');
    c.dataset.pointIndex = String(i);
    svg.appendChild(c);
  });
  row.appendChild(svg);

  wireGestures(svg, track.id, param, sr);
  return row;
}

/** La lane existante ou CREEE (premier geste) - id rendu. */
function ensureLane(trackId: string, param: string): string | null {
  if (!ctx.project) return null;
  const track = ctx.project.getDocument().tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const existing = laneFor(track, param);
  if (existing) return existing.id;
  return ctx.project.addAutomationLane(trackId, { param });
}

function wireGestures(svg: SVGSVGElement, trackId: string,
  param: 'gain' | 'pan', sr: number): void {
  // AJOUTER : double-clic sur la courbe (cree la lane au premier geste)
  svg.addEventListener('dblclick', (e) => {
    if (!ctx.project) return;
    const r = svg.getBoundingClientRect();
    ctx.project.beginUndoGroup();
    const laneId = ensureLane(trackId, param);
    if (laneId) {
      ctx.project.addAutomationPoint(trackId, laneId,
        tOf(e.clientX - r.left, sr), vOf(e.clientY - r.top));
    }
    ctx.project.endUndoGroup();
    sendLastChange();
    renderTracks(true);
  });

  // DEPLACER : drag d'un point (groupe d'undo par geste) ; SUPPRIMER :
  // clic droit sur un point ; menu de lane : clic droit ailleurs.
  svg.addEventListener('pointerdown', (e) => {
    const target = e.target as SVGElement;
    if (e.button !== 0 || !target.classList.contains('automation-point')) return;
    if (!ctx.project) return;
    const doc = ctx.project.getDocument();
    const track = doc.tracks.find((t) => t.id === trackId);
    const lane = track ? laneFor(track, param) : null;
    if (!lane) return;
    e.preventDefault();
    e.stopPropagation();  // le drag de clip/piste ne doit rien voir
    let index = Number(target.dataset.pointIndex);
    let lastT = lane.points[index]?.t;
    let lastV = lane.points[index]?.v;
    if (lastT === undefined) return;
    const r = svg.getBoundingClientRect();
    ctx.project.beginUndoGroup();
    svg.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      if (!ctx.project) return;
      const t = tOf(ev.clientX - r.left, sr);
      const v = vOf(ev.clientY - r.top);
      // retrouver l'index COURANT par la valeur ecrite (le tri a pu le
      // deplacer en traversant un voisin)
      const tr = ctx.project.getDocument().tracks.find((x) => x.id === trackId);
      const ln = tr ? laneFor(tr, param) : null;
      if (!ln) return;
      index = ln.points.findIndex((p) => p.t === lastT && p.v === lastV);
      if (index < 0) return;
      ctx.project.moveAutomationPoint(trackId, ln.id, index, t, v);
      lastT = clampT(t); lastV = clampV(v);
      // feedback direct sans rebuild complet : bouger le cercle + la courbe
      target.setAttribute('cx', String(xOf(lastT, sr)));
      target.setAttribute('cy', String(yOf(lastV)));
    };
    const onUp = (ev: PointerEvent): void => {
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      try { svg.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      ctx.project?.endUndoGroup();
      sendLastChange();
      renderTracks(true);
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
  });

  svg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();  // pas le dispatch global : menu specifique
    if (!ctx.project) return;
    const doc = ctx.project.getDocument();
    const track = doc.tracks.find((t) => t.id === trackId);
    const lane = track ? laneFor(track, param) : null;
    const target = e.target as SVGElement;
    if (lane && target.classList.contains('automation-point')) {
      const index = Number(target.dataset.pointIndex);
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Supprimer le point', danger: true, onClick: () => {
          ctx.project!.deleteAutomationPoint(trackId, lane.id, index);
          sendLastChange(); renderTracks(true);
        } },
      ]);
      return;
    }
    if (lane) {
      showContextMenu(e.clientX, e.clientY, [
        { label: lane.enabled ? 'Bypass (le manuel reprend)' : 'Activer l\'enveloppe',
          onClick: () => {
            ctx.project!.setAutomationLaneEnabled(trackId, lane.id, !lane.enabled);
            sendLastChange(); renderTracks(true);
          } },
        { separator: true },
        { label: 'Supprimer l\'enveloppe', danger: true, onClick: () => {
          ctx.project!.deleteAutomationLane(trackId, lane.id);
          sendLastChange(); renderTracks(true);
        } },
      ]);
    }
  });
}
