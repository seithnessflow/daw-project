// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * DAW Web Client — la vraie UI (conventions: docs/UI-CONVENTIONS.md).
 *
 * Structure: control bar top / split ruler (seek band only) / track
 * headers left + time lanes / Device View bottom for the SELECTED track.
 * Seek lives on the ruler's seek band ONLY (all three DAWs agree);
 * clicking a track row selects it.
 */

import { Project } from './document/project';
import { ServerClient } from './network/server_client';
import { EngineClient } from './network/engine_client';
import {
  createTrackUI,
  createRulerUI,
  createDeviceView,
  updateMeter,
  updateTrackGainUI,
  updateDeviceViewUI,
  TIMELINE,
} from './ui/track';
import { formatTime } from './ui/transport';
import { Library, loadKit } from './ui/library';
import { fillWaveforms } from './ui/waveform';
import { Overview } from './ui/overview';

// Configuration
const SERVER_URL = 'ws://localhost:3000';
const ENGINE_PORT = 47821;
const PROJECT_ID =
  new URLSearchParams(window.location.search).get('project') ?? 'default';

// State
let project: Project | null = null;
let selectedTrackId: string | null = null;
let selectedClipId: string | null = null;
let justDragged = false;   // a finished drag must not fire the click path

// ---- Navigation state (potion phase A1) ------------------------------
// pps lives in TIMELINE (mutable); zoom re-renders around an anchor.
let insertMarkerSec = 0;     // Ableton insert marker: Play starts HERE
let follow = true;           // view chases the playhead...
let followPaused = false;    // ...until the user scrolls/zooms/edits
let programmaticScroll = false;
let zoomRaf = 0;

const ZOOM_MIN = 4;
const ZOOM_MAX = 200;

function contentSeconds(): number {
  const doc = project?.getDocument();
  let end = 30;
  if (doc) {
    const sr = doc.sampleRate || 48000;
    for (const t of doc.tracks) {
      for (const c of t.clips) {
        end = Math.max(end, (c.startSample + c.lengthSamples) / sr);
      }
    }
  }
  return Math.ceil(end) + 5;
}

/** Zoom to newPps keeping anchorSec at the same viewport x. */
function setZoom(newPps: number, anchorSec: number, anchorViewportX: number): void {
  const pps = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newPps));
  if (pps === TIMELINE.pps) return;
  TIMELINE.pps = pps;
  followPaused = true;
  if (zoomRaf) return;               // coalesce zoom ticks to one render
  zoomRaf = requestAnimationFrame(() => {
    zoomRaf = 0;
    renderTracks(true);
    programmaticScroll = true;
    tracksContainer.scrollLeft =
      Math.max(0, anchorSec * TIMELINE.pps - (anchorViewportX - TIMELINE.headWidth));
  });
}

function updateInsertMarker(): void {
  const marker = document.getElementById('insert-marker');
  if (marker) {
    marker.style.left = `${TIMELINE.headWidth + insertMarkerSec * TIMELINE.pps}px`;
  }
  refreshOverview();
}

/** Redraw the overview strip (rAF-coalesced; cheap canvas pass). */
function refreshOverview(): void {
  if (!overview || !project || overviewRaf) return;
  overviewRaf = requestAnimationFrame(() => {
    overviewRaf = 0;
    if (!overview || !project) return;
    const doc = project.getDocument();
    const viewStart = Math.max(0,
      (tracksContainer.scrollLeft) / TIMELINE.pps);
    const viewEnd = viewStart +
      (tracksContainer.clientWidth - TIMELINE.headWidth) / TIMELINE.pps;
    overview.render(doc, contentSeconds(), viewStart, viewEnd,
      lastPlayheadSec, insertMarkerSec);
  });
}

function fitAll(): void {
  const rect = tracksContainer.getBoundingClientRect();
  const fit = (rect.width - TIMELINE.headWidth - 20) / contentSeconds();
  setZoom(fit, 0, TIMELINE.headWidth);
}

/** Snap grid step in seconds, refined as the zoom deepens. */
function snapStep(): number {
  const pps = TIMELINE.pps;
  if (pps >= 80) return 0.0625;
  if (pps >= 40) return 0.125;
  if (pps >= 10) return 0.25;
  return 0.5;
}

/**
 * Clip drag (potion C1): the title bar moves the clip - snapped to the
 * grid AND to the other clips' edges on the same track, Alt = free.
 * Coalescing: at most one document write per animation frame during the
 * gesture, a final one on release (the fader's road).
 */
function beginClipDrag(e: PointerEvent, handle: HTMLElement): void {
  if (!project) return;
  const clipEl = handle.closest('.clip') as HTMLElement | null;
  const trackEl = handle.closest('[data-track-id]') as HTMLElement | null;
  if (!clipEl || !trackEl) return;
  const clipId = clipEl.dataset.clipId!;
  const trackId = trackEl.getAttribute('data-track-id')!;
  const doc = project.getDocument();
  const sr = doc.sampleRate || 48000;
  const track = doc.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip) return;

  // Neighbor edges (start/end of every OTHER clip on this track)
  const edges: number[] = [];
  for (const c of track.clips) {
    if (c.id === clipId) continue;
    edges.push(c.startSample / sr, (c.startSample + c.lengthSamples) / sr);
  }

  const startX = e.clientX;
  const origSec = clip.startSample / sr;
  let moved = false;
  let pendingSec = origSec;
  let writeRaf = 0;
  e.preventDefault();

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;    // click, not yet a drag
    moved = true;
    clipEl.classList.add('dragging');
    let sec = Math.max(0, origSec + dx / TIMELINE.pps);
    if (!ev.altKey) {
      const step = snapStep();
      let snapped = Math.round(sec / step) * step;
      // Neighbor edges win within 8 px
      for (const edge of edges) {
        if (Math.abs(sec - edge) * TIMELINE.pps < 8) { snapped = edge; break; }
      }
      sec = Math.max(0, snapped);
    }
    clipEl.style.left = `${sec * TIMELINE.pps}px`;
    pendingSec = sec;
    if (!writeRaf) {
      writeRaf = requestAnimationFrame(() => {
        writeRaf = 0;
        project!.setClipStart(trackId, clipId, pendingSec * sr);
        sendLastChange();
      });
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (writeRaf) cancelAnimationFrame(writeRaf);
    clipEl.classList.remove('dragging');
    if (moved) {
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 0);
      project!.setClipStart(trackId, clipId, pendingSec * sr);
      sendLastChange();
      renderTracks(true);
    } else {
      // A plain click on the title bar: select the clip (and its track)
      selectedClipId = clipId;
      selectedTrackId = trackId;
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 0);
      renderTracks(true);
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function startPlayback(): void {
  if (!engineClient?.isConnected()) return;
  const sr = project?.getDocument().sampleRate || 48000;
  engineClient.seek(Math.round(insertMarkerSec * sr));
  engineClient.play();
  followPaused = false;              // Follow resumes on restart (Ableton)
}

function stopPlayback(): void {
  if (!engineClient?.isConnected()) return;
  const sr = project?.getDocument().sampleRate || 48000;
  if (engineClient.isPlaying()) {
    engineClient.stop();             // 1st stop: halt where you are
  } else {
    engineClient.seek(Math.round(insertMarkerSec * sr));  // 2nd: come home
  }
}

declare global {
  interface Window {
    __dawProject: Project | null;
  }
}
window.__dawProject = null;
let serverClient: ServerClient | null = null;
let engineClient: EngineClient | null = null;
let library: Library | null = null;
let overview: Overview | null = null;
let lastPlayheadSec = -1;
let overviewRaf = 0;
const zoomStack: { pps: number; scrollLeft: number }[] = [];

// DOM elements
const serverStatus = document.getElementById('server-status')!;
const engineStatus = document.getElementById('engine-status')!;
const positionEl = document.getElementById('position')!;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const tracksContainer = document.getElementById('tracks')!;
const deviceViewSlot = document.getElementById('device-view-slot')!;
const addTrackBtn = document.getElementById('add-track-btn') as HTMLButtonElement;

/** Push the last local change to the server (the one road out). */
function sendLastChange(): void {
  const change = project?.getLastChange();
  if (change && serverClient) {
    serverClient.sendChange(change);
  }
}

async function init() {
  console.log('DAW Web Client starting...');

  project = new Project();
  window.__dawProject = project;

  serverClient = new ServerClient(SERVER_URL);
  serverClient.onConnect = () => {
    serverStatus.classList.add('connected');
    // Selection contract: tests read data-state, the class only styles
    serverStatus.dataset.state = 'connected';
    console.log('Connected to server');
  };
  serverClient.onDisconnect = () => {
    serverStatus.classList.remove('connected');
    serverStatus.dataset.state = 'disconnected';
    console.log('Disconnected from server');
  };
  let hasLoadedInitialDoc = false;
  // Anti-entropy cycles still owed after a reconnection (see below)
  let resyncCycles = 0;
  serverClient.onDocument = (data) => {
    if (!hasLoadedInitialDoc) {
      // Very first document: adopt the server state wholesale (the local
      // document is a pristine placeholder with no user edits)
      project!.load(data);
      hasLoadedInitialDoc = true;
    } else {
      // Reconnection: MERGE the server document into the local one -
      // never replace it, so offline edits survive and reconcile
      console.log('Reconnected: merging server document into local state');
      const hadPending = serverClient!.pendingCount() > 0;
      const mergedNovelty = project!.mergeRemote(data);
      // Anti-entropy: whenever an exchange moved anything, demand TWO
      // consecutive no-op exchanges before stopping the verification
      // cycles (a peer's late flush can land while we are mid-cycle).
      if (mergedNovelty || hadPending) {
        resyncCycles = 2;
      } else if (resyncCycles > 0) {
        resyncCycles--;
      }
      if (resyncCycles > 0) {
        serverClient!.requestResync();
      }
    }
    renderTracks();
  };
  serverClient.onChange = (change) => {
    project!.applyChange(change);
    renderTracks();
  };

  // Engine connection (token from URL; written by the engine to %TEMP%)
  const urlParams = new URLSearchParams(window.location.search);
  const engineToken = urlParams.get('token') ?? '';
  engineClient = new EngineClient({ port: ENGINE_PORT, token: engineToken });
  engineClient.onConnect = () => {
    engineStatus.classList.add('connected');
    engineStatus.dataset.state = 'connected';
    playBtn.disabled = false;
    stopBtn.disabled = false;
    console.log('Connected to engine');
  };
  engineClient.onDisconnect = () => {
    engineStatus.classList.remove('connected');
    engineStatus.dataset.state = 'disconnected';
    playBtn.disabled = true;
    stopBtn.disabled = true;
    console.log('Disconnected from engine');
  };
  engineClient.onPosition = (samples, sampleRate) => {
    positionEl.textContent = formatTime(samples, sampleRate);
    lastPlayheadSec = samples / sampleRate;
    refreshOverview();
    // Playhead on the shared scale, PARKED at the lane's end when the
    // engine plays past the content (its transport never stops on its
    // own): an escaped playhead stretched the scroll width into nowhere.
    const playhead = document.getElementById('playhead');
    if (playhead) {
      const lane = document.querySelector('.track-lane') as HTMLElement | null;
      const laneW = lane ? lane.offsetWidth : Infinity;
      const x = (samples / sampleRate) * TIMELINE.pps;
      playhead.style.left = `${TIMELINE.headWidth + Math.min(x, laneW)}px`;

      // Follow: keep the playhead in the comfort zone while playing
      if (follow && !followPaused && engineClient?.isPlaying()) {
        const viewW = tracksContainer.clientWidth;
        const headX = TIMELINE.headWidth + Math.min(x, laneW) - tracksContainer.scrollLeft;
        if (headX > viewW * 0.7 || headX < TIMELINE.headWidth) {
          programmaticScroll = true;
          tracksContainer.scrollLeft = Math.max(0,
            TIMELINE.headWidth + Math.min(x, laneW) - viewW * 0.3);
        }
      }
    }
  };
  engineClient.onMeters = (meters) => {
    for (const { trackId, peakLeft, peakRight } of meters) {
      updateMeter(trackId, Math.max(peakLeft, peakRight));
    }
  };

  // Transport, Ableton semantics (potion A1): Play starts from the
  // insert marker; Stop halts, Stop again returns to the marker.
  playBtn.addEventListener('click', startPlayback);
  stopBtn.addEventListener('click', stopPlayback);

  // Follow toggle (view chases the playhead; pauses on user scroll/zoom)
  const followBtn = document.getElementById('follow-btn') as HTMLButtonElement;
  followBtn.setAttribute('aria-pressed', 'true');
  followBtn.addEventListener('click', () => {
    follow = !follow;
    followPaused = false;
    followBtn.setAttribute('aria-pressed', follow ? 'true' : 'false');
  });

  // The base kit's library strip (chips: arm, then click a lane to place)
  const kit = await loadKit();
  if (kit) {
    library = new Library(kit);
    document.getElementById('library-slot')!.appendChild(library.element);
  }

  // The Overview: whole project, always visible (potion A2)
  overview = new Overview({
    onScrollTo: (sec) => {
      followPaused = true;
      programmaticScroll = true;
      tracksContainer.scrollLeft = Math.max(0,
        sec * TIMELINE.pps - (tracksContainer.clientWidth - TIMELINE.headWidth) / 2);
      refreshOverview();
    },
    onZoom: (factor, anchorSec) => {
      const rect = tracksContainer.getBoundingClientRect();
      setZoom(TIMELINE.pps * factor, anchorSec,
        TIMELINE.headWidth + (rect.width - TIMELINE.headWidth) / 2);
    },
    onFit: fitAll,
  });
  document.getElementById('overview-slot')!.appendChild(overview.element);

  // Seek ONLY on the ruler's seek band (docs/UI-CONVENTIONS.md: all
  // three DAWs reserve the clip area for selection/editing). A lane
  // click PLACES the armed sample if one is armed, else selects the
  // track (its chain appears in the Device View).
  // Clip drag entry point (delegated: clips are rebuilt constantly)
  tracksContainer.addEventListener('pointerdown', (e) => {
    const handle = (e.target as HTMLElement)
      .closest('[data-role="clip-handle"]') as HTMLElement | null;
    if (handle) beginClipDrag(e, handle);
  });

  tracksContainer.addEventListener('click', (e) => {
    if (justDragged) return;   // the pointerup already did the work
    const target = e.target as HTMLElement;
    const seekBand = target.closest('[data-role="seek"]') as HTMLElement | null;
    if (seekBand && engineClient) {
      const x = e.clientX - seekBand.getBoundingClientRect().left;
      const sr = project?.getDocument().sampleRate || 48000;
      engineClient.seek(Math.round(Math.max(0, x / TIMELINE.pps) * sr));
      return;
    }
    const trackEl = target.closest('[data-track-id]') as HTMLElement | null;
    if (!trackEl) return;
    const id = trackEl.getAttribute('data-track-id');
    if (!id || !project) return;

    const armed = library?.getArmed() ?? null;
    const lane = target.closest('.track-lane') as HTMLElement | null;
    if (armed && lane) {
      // Place the armed sample, snapped to a 0.25 s grid
      const sr = project.getDocument().sampleRate || 48000;
      const x = e.clientX - lane.getBoundingClientRect().left;
      const seconds = Math.max(0, Math.round((x / TIMELINE.pps) / 0.25) * 0.25);
      project.addClip(id, {
        id: `clip-${armed.name}-${Date.now()}`,
        assetHash: armed.hash,
        startSample: Math.round(seconds * sr),
        lengthSamples: Math.round(armed.seconds * sr),
        offsetSamples: 0,
      });
      sendLastChange();
      renderTracks();
      return;
    }
    // Lane click (unarmed): select the track AND set the insert marker
    // (Ableton: one click, two effects, zero conflict). Deselects any
    // selected clip - one selected object at a time.
    selectedClipId = null;
    if (lane) {
      const x = e.clientX - lane.getBoundingClientRect().left;
      insertMarkerSec = Math.max(0, Math.round((x / TIMELINE.pps) / 0.25) * 0.25);
      updateInsertMarker();
      followPaused = true;   // editing intent: stop chasing the playhead
    }
    if (id !== selectedTrackId) {
      selectedTrackId = id;
      renderTracks(true);
    }
  });

  // Keyboard (potion A1). Space = play/stop; +/- = zoom around the
  // viewport center; W = fit content width; H = compact tracks. All
  // ignored while a control is focused.
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      if (!engineClient?.isConnected()) return;
      if (engineClient.isPlaying()) stopPlayback();
      else startPlayback();
      return;
    }
    const rect = tracksContainer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerSec = Math.max(0,
      (tracksContainer.scrollLeft + rect.width / 2 - TIMELINE.headWidth) / TIMELINE.pps);
    if (e.key === '+' || e.key === '=') {
      setZoom(TIMELINE.pps * 1.25, centerSec, centerX - rect.left);
    } else if (e.key === '-') {
      setZoom(TIMELINE.pps / 1.25, centerSec, centerX - rect.left);
    } else if (e.code === 'KeyW') {
      fitAll();
    } else if (e.code === 'KeyH') {
      document.body.classList.toggle('compact-tracks');
    } else if (e.code === 'KeyZ') {
      // Zoom to the marker's neighborhood; X pops back (Ableton Z/X)
      zoomStack.push({ pps: TIMELINE.pps, scrollLeft: tracksContainer.scrollLeft });
      const windowSec = 8;
      const pps = (rect.width - TIMELINE.headWidth) / windowSec;
      setZoom(pps, Math.max(0, insertMarkerSec - windowSec / 2), TIMELINE.headWidth);
    } else if (e.code === 'KeyX') {
      const prev = zoomStack.pop();
      if (prev) {
        TIMELINE.pps = prev.pps;
        renderTracks(true);
        programmaticScroll = true;
        tracksContainer.scrollLeft = prev.scrollLeft;
        refreshOverview();
      }
    }
  });

  // Ctrl+wheel = zoom around the cursor; plain wheel/scroll pauses Follow
  tracksContainer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) {
      followPaused = true;
      return;
    }
    e.preventDefault();
    const rect = tracksContainer.getBoundingClientRect();
    const viewportX = e.clientX - rect.left;
    const anchorSec = Math.max(0,
      (tracksContainer.scrollLeft + viewportX - TIMELINE.headWidth) / TIMELINE.pps);
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    setZoom(TIMELINE.pps * factor, anchorSec, viewportX);
  }, { passive: false });

  tracksContainer.addEventListener('scroll', () => {
    refreshOverview();
    if (programmaticScroll) {
      programmaticScroll = false;
      return;
    }
    followPaused = true;
  });

  addTrackBtn.addEventListener('click', () => {
    if (!project) return;
    const trackCount = project.getDocument().tracks.length;
    project.addTrack({
      id: `track-${Date.now()}`,
      name: `Track ${trackCount + 1}`,
      gain: 1.0,
      clips: [],
      chain: [],
    });
    sendLastChange();
    renderTracks();
  });

  try {
    await serverClient.connect(PROJECT_ID);
  } catch (e) {
    console.error('Failed to connect to server:', e);
  }
  try {
    await engineClient.connect();
  } catch (e) {
    console.error('Failed to connect to engine:', e);
  }
}

/**
 * Render tracks + Device View from the project document.
 *
 * Same structure -> update gains/bypass/params in place (a full rebuild
 * on every received change would thrash the DOM and yank sliders out of
 * the local user's hand). `force` rebuilds regardless (track selection).
 */
function renderTracks(force = false) {
  if (!project) return;
  const doc = project.getDocument();

  if (selectedTrackId === null || !doc.tracks.some((t) => t.id === selectedTrackId)) {
    selectedTrackId = doc.tracks[0]?.id ?? null;
  }
  const selectedTrack = doc.tracks.find((t) => t.id === selectedTrackId) ?? null;

  const existingEls = Array.from(tracksContainer.querySelectorAll('[data-track-id]'));
  const deviceCount = deviceViewSlot.querySelectorAll('.device').length;
  const sameStructure =
    !force &&
    existingEls.length === doc.tracks.length &&
    doc.tracks.every(
      (t, i) =>
        existingEls[i].getAttribute('data-track-id') === t.id &&
        existingEls[i].querySelectorAll('.clip').length === t.clips.length
    ) &&
    deviceCount === (selectedTrack?.chain.length ?? 0);

  if (sameStructure) {
    for (const track of doc.tracks) {
      updateTrackGainUI(track.id, track.gain);
    }
    if (selectedTrack) updateDeviceViewUI(selectedTrack.chain);
    return;
  }

  tracksContainer.innerHTML = '';

  // Shared time scale: the longest clip end, with margin (min 35 s)
  const sr = doc.sampleRate || 48000;
  let endSec = 30;
  for (const t of doc.tracks) {
    for (const c of t.clips) {
      endSec = Math.max(endSec, (c.startSample + c.lengthSamples) / sr);
    }
  }
  const laneSeconds = Math.ceil(endSec) + 5;

  tracksContainer.appendChild(createRulerUI(laneSeconds));

  for (const track of doc.tracks) {
    const element = createTrackUI(
      track, sr, laneSeconds, track.id === selectedTrackId,
      (gain) => {
        project!.setTrackGain(track.id, gain);
        sendLastChange();
      },
      (kind, on) => {
        // Engine-local monitoring (not document state); wired in lot C
        engineClient?.setMonitor(track.id,
          kind === 'solo' ? on : undefined, kind === 'mute' ? on : undefined);
      },
    );
    tracksContainer.appendChild(element);
  }

  // One playhead across ruler and every lane (moved by onPosition)
  const playhead = document.createElement('div');
  playhead.className = 'playhead';
  playhead.id = 'playhead';
  playhead.style.left = `${TIMELINE.headWidth}px`;
  tracksContainer.appendChild(playhead);

  // The insert marker (potion A1): where Play starts from
  const marker = document.createElement('div');
  marker.className = 'insert-marker';
  marker.id = 'insert-marker';
  tracksContainer.appendChild(marker);
  updateInsertMarker();

  // Selection reflection (C1): the selected clip is unambiguous
  if (selectedClipId) {
    const el = tracksContainer.querySelector(
      `[data-clip-id="${selectedClipId}"]`) as HTMLElement | null;
    if (el) el.setAttribute('aria-selected', 'true');
    else selectedClipId = null;
  }

  // Device View for the selected track (bypass and params are DOCUMENT
  // state: the display only settles when the change comes back)
  deviceViewSlot.innerHTML = '';
  deviceViewSlot.appendChild(createDeviceView(
    selectedTrack,
    (procId, bypass) => {
      project!.setProcessorBypass(selectedTrackId!, procId, bypass);
      sendLastChange();
      renderTracks();
    },
    (procId, key, value) => {
      project!.setProcessorParam(selectedTrackId!, procId, key, value);
      sendLastChange();
    },
  ));

  // Waveforms inside the freshly built clips (cached peaks draw
  // synchronously; new assets stream in from the store)
  fillWaveforms(tracksContainer);
  refreshOverview();
}

// Start
init().catch(console.error);
