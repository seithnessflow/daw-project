// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Clic droit CONTEXTUEL (2026-08-26, demande utilisateur) : le menu s'adapte a
 * la zone cliquee. Chaque zone construit sa liste d'actions a partir des
 * methodes EXISTANTES (project.ts + engineClient) - aucun nouveau backend.
 * Zones : clip, piste (arrangement), device (rack), slot Session, tranche
 * mixer, item du navigateur. Ailleurs : pas de menu (le natif reste).
 */

import { ctx, sendLastChange } from './context';
import { renderTracks } from './render';
import { showContextMenu, type MenuItem } from '../ui/context_menu';
import { startInlineRename } from '../ui/inline_rename';
import { renderSession } from '../ui/session';
import { clipDisplayName } from '../document/schema';
import * as life from '../ui/life';

function closest(el: EventTarget | null, sel: string): HTMLElement | null {
  return el instanceof Element ? (el.closest(sel) as HTMLElement | null) : null;
}

/** Construit la liste d'actions selon la cible ; null = pas de menu custom. */
function buildItems(target: EventTarget | null): MenuItem[] | null {
  const project = ctx.project;
  if (!project) return null;
  const doc = () => project.getDocument();

  // ---- CLIP (arrangement) ----
  const clipEl = closest(target, '#tracks .clip[data-clip-id]');
  if (clipEl) {
    const clipId = clipEl.dataset.clipId!;
    const trackEl = clipEl.closest('[data-track-id]') as HTMLElement | null;
    const trackId = trackEl?.getAttribute('data-track-id');
    if (!trackId) return null;
    return [
      { label: 'Renommer', onClick: () => {
        const c = doc().tracks.find((x) => x.id === trackId)
          ?.clips.find((x) => x.id === clipId);
        const strip = clipEl.querySelector<HTMLElement>('.clip-name');
        if (!c || !strip) return;
        startInlineRename(strip, clipDisplayName(c), (name) => {
          project.renameClip(trackId, clipId, name);
          sendLastChange(); renderTracks(true);
        });
      } },
      { label: 'Dupliquer', onClick: () => {
        const t = doc().tracks.find((x) => x.id === trackId);
        const c = t?.clips.find((x) => x.id === clipId);
        if (!c) return;
        project.addClip(trackId, {
          ...c,
          id: `clip-${Math.random().toString(36).slice(2, 10)}`,
          startSample: c.startSample + c.lengthSamples,
        } as never);
        sendLastChange(); renderTracks(true);
      } },
      { separator: true },
      { label: 'Supprimer', danger: true, onClick: () => {
        project.deleteClip(trackId, clipId); sendLastChange(); renderTracks(true);
      } },
    ];
  }

  // ---- DEVICE (rack) ----
  const devEl = closest(target, '.device[data-proc-id]');
  if (devEl) {
    const procId = devEl.dataset.procId!;
    const trackId = ctx.selectedTrackId;
    if (!trackId) return null;
    const proc = doc().tracks.find((t) => t.id === trackId)?.chain.find((p) => p.id === procId);
    const bypassed = !!proc?.bypass;
    const isVst3 = proc?.type === 'vst3';
    const items: MenuItem[] = [];
    if (isVst3) {
      const ed = devEl.querySelector('[data-role="editor"]');
      const open = ed?.getAttribute('aria-pressed') !== 'true';
      items.push({ label: open ? 'Ouvrir la fenetre du plugin' : 'Fermer la fenetre', onClick: () => {
        ed?.setAttribute('aria-pressed', open ? 'true' : 'false');
        ctx.engineClient?.setEditor(procId, open);
      } });
    }
    items.push({ label: bypassed ? 'Reactiver (bypass off)' : 'Bypass', onClick: () => {
      project.setProcessorBypass(trackId, procId, !bypassed); sendLastChange(); renderTracks(true);
    } });
    items.push({ separator: true });
    items.push({ label: 'Retirer le device', danger: true, onClick: () => {
      project.removeProcessor(trackId, procId); sendLastChange(); renderTracks(true);
    } });
    return items;
  }

  // ---- SCENE (bouton de ligne du clip-launcher, F5+) ----
  const sceneEl = closest(target, '.ss-scene[data-ss-scene-btn]');
  if (sceneEl) {
    const sceneId = sceneEl.dataset.ssSceneBtn!;
    return [
      { label: 'Renommer', onClick: () => {
        const sc = (doc().scenes ?? []).find((s) => s.id === sceneId);
        if (!sc) return;
        startInlineRename(sceneEl, sc.name, (name) => {
          project.renameScene(sceneId, name);
          sendLastChange(); renderSession();
        });
      } },
      { label: 'Dupliquer la scene', onClick: () => {
        project.duplicateScene(sceneId);
        sendLastChange(); renderSession(); renderTracks(true);
      } },
      { separator: true },
      { label: 'Supprimer la scene (et ses slots)', danger: true, onClick: () => {
        // le moteur peut jouer un slot de cette scene : on l'arrete d'abord
        ctx.engineClient?.sessionLaunch(sceneId, '', true);
        project.deleteScene(sceneId);
        sendLastChange(); renderSession(); renderTracks(true);
      } },
    ];
  }

  // ---- SLOT Session ----
  const slotEl = closest(target, '.ss-slot');
  if (slotEl) {
    const trackId = slotEl.dataset.ssTrack!;
    const sceneId = slotEl.dataset.ssScene!;
    const clipId = slotEl.dataset.ssClip;
    if (clipId) {
      return [
        { label: 'Editer (piano-roll)', onClick: () => {
          ctx.selectedTrackId = trackId; renderTracks(true);
        } },
        { label: 'Lancer / arreter', onClick: () => {
          ctx.engineClient?.sessionLaunch(sceneId, trackId, false);
        } },
        { separator: true },
        { label: 'Supprimer le slot', danger: true, onClick: () => {
          project.deleteClip(trackId, clipId); sendLastChange(); renderSession(); renderTracks(true);
        } },
      ];
    }
    return [
      { label: 'Creer un clip ici', onClick: () => {
        project.addSessionClip(trackId, sceneId); ctx.selectedTrackId = trackId;
        sendLastChange(); renderSession(); renderTracks(true);
      } },
    ];
  }

  // ---- TRANCHE MIXER ----
  const stripEl = closest(target, '.mx-strip');
  if (stripEl) {
    const trackId = stripEl.querySelector('.mx-vu')?.getAttribute('data-track-id');
    if (!trackId || trackId === '__master__') return null;
    return [
      { label: 'Gain a 0 dB', onClick: () => {
        project.setTrackGain(trackId, 1); sendLastChange(); renderTracks(); } },
      { label: 'Pan au centre', onClick: () => {
        project.setTrackPan(trackId, 0); sendLastChange(); renderTracks(); } },
    ];
  }

  // ---- PISTE (tete d'arrangement) ----
  const trackEl = closest(target, '#tracks [data-track-id]');
  if (trackEl) {
    const trackId = trackEl.getAttribute('data-track-id')!;
    const mon = (ctx.engineClient?.monitorSnapshot?.() ?? {}) as Record<string, { mute?: boolean; solo?: boolean }>;
    const m = mon[trackId] ?? {};
    const setMon = (kind: 'mute' | 'solo', on: boolean): void => {
      ctx.engineClient?.setMonitor(trackId, kind === 'solo' ? on : undefined, kind === 'mute' ? on : undefined);
      if (ctx.engineClient) life.applyMonitorShade(ctx.engineClient.monitorSnapshot());
    };
    return [
      { label: 'Renommer', onClick: () => {
        const t = doc().tracks.find((x) => x.id === trackId);
        const nameEl = trackEl.querySelector<HTMLElement>('.track-name');
        if (!t || !nameEl) return;
        startInlineRename(nameEl, t.name, (name) => {
          project.renameTrack(trackId, name);
          sendLastChange(); renderTracks(true);
        });
      } },
      { separator: true },
      { label: m.mute ? 'Reactiver (unmute)' : 'Muter', onClick: () => setMon('mute', !m.mute) },
      { label: m.solo ? 'Enlever le solo' : 'Solo', onClick: () => setMon('solo', !m.solo) },
      { separator: true },
      { label: '+ clip MIDI', onClick: () => {
        project.addMidiClip(trackId, 0, 96000); ctx.selectedTrackId = trackId;
        sendLastChange(); renderTracks(true); } },
      { separator: true },
      { label: 'Supprimer la piste', danger: true, onClick: () => {
        project.deleteTrack(trackId); sendLastChange(); renderTracks(true); } },
    ];
  }

  return null;
}

export function initContextMenu(): void {
  document.addEventListener('contextmenu', (e) => {
    const items = buildItems(e.target);
    if (items && items.length) {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, items);
    }
  });
}
