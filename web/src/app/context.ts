// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Shared app context (split rule 2026-08-22): configuration, mutable
 * state and DOM anchors, in ONE place - every app module reads and
 * writes through `ctx`, nothing else owns state.
 */

import type { Project } from '../document/project';
import type { ServerClient } from '../network/server_client';
import type { EngineClient } from '../network/engine_client';
import type { Library } from '../ui/library';
import type { Overview } from '../ui/overview';

// ---- Configuration --------------------------------------------------------
// 1bis: the sync server can be REMOTE (two machines, one project).
// ?server=<host:port | ws://url> - defaults to the local dev server.
const serverParam = new URLSearchParams(window.location.search).get('server');
const serverBase = serverParam
  ? (serverParam.includes('://') ? serverParam : `ws://${serverParam}`)
  : 'ws://localhost:3000';
export const SERVER_URL = serverBase;
/** HTTP side of the same server (assets store). ONE source of truth. */
export const SERVER_HTTP = serverBase.replace(/^ws/, 'http');
export const ENGINE_PORT = 47821;
export const PROJECT_ID =
  new URLSearchParams(window.location.search).get('project') ?? 'default';
// Magic Potion phase 1: the embedded KIT and lab fixtures are the TEST
// harness, not the product - visible only behind ?lab=1.
export const LAB_MODE =
  new URLSearchParams(window.location.search).get('lab') === '1';

export const ZOOM_MIN = 4;
export const ZOOM_MAX = 200;

// ---- Mutable state --------------------------------------------------------
export const ctx = {
  project: null as Project | null,
  serverClient: null as ServerClient | null,
  engineClient: null as EngineClient | null,
  library: null as Library | null,
  overview: null as Overview | null,

  // Selection (one selected object at a time)
  selectedTrackId: null as string | null,
  selectedClipId: null as string | null,
  justDragged: false,   // a finished drag must not fire the click path

  // Navigation (potion A1/A2)
  insertMarkerSec: 0,   // Ableton insert marker: Play starts HERE
  follow: true,         // view chases the playhead...
  followPaused: false,  // ...until the user scrolls/zooms/edits
  programmaticScroll: false,
  lastPlayheadSec: -1,
  zoomStack: [] as { pps: number; scrollLeft: number }[],
};

// ---- DOM anchors ----------------------------------------------------------
export const els = {
  serverStatus: document.getElementById('server-status')!,
  engineStatus: document.getElementById('engine-status')!,
  position: document.getElementById('position')!,
  playBtn: document.getElementById('play-btn') as HTMLButtonElement,
  stopBtn: document.getElementById('stop-btn') as HTMLButtonElement,
  tracks: document.getElementById('tracks')!,
  deviceViewSlot: document.getElementById('device-view-slot')!,
  addTrackBtn: document.getElementById('add-track-btn') as HTMLButtonElement,
};

/** Push the last local change to the server (the one road out). */
export function sendLastChange(): void {
  const change = ctx.project?.getLastChange();
  if (change && ctx.serverClient) {
    ctx.serverClient.sendChange(change);
  }
}
