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

// Configuration
const SERVER_URL = 'ws://localhost:3000';
const ENGINE_PORT = 47821;
const PROJECT_ID =
  new URLSearchParams(window.location.search).get('project') ?? 'default';

// State
let project: Project | null = null;
let selectedTrackId: string | null = null;

declare global {
  interface Window {
    __dawProject: Project | null;
  }
}
window.__dawProject = null;
let serverClient: ServerClient | null = null;
let engineClient: EngineClient | null = null;

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
    // Playhead on the shared scale, PARKED at the lane's end when the
    // engine plays past the content (its transport never stops on its
    // own): an escaped playhead stretched the scroll width into nowhere.
    const playhead = document.getElementById('playhead');
    if (playhead) {
      const lane = document.querySelector('.track-lane') as HTMLElement | null;
      const laneW = lane ? lane.offsetWidth : Infinity;
      const x = (samples / sampleRate) * TIMELINE.pps;
      playhead.style.left = `${TIMELINE.headWidth + Math.min(x, laneW)}px`;
    }
  };
  engineClient.onMeters = (meters) => {
    for (const { trackId, peakLeft, peakRight } of meters) {
      updateMeter(trackId, Math.max(peakLeft, peakRight));
    }
  };

  // Transport. Stop REWINDS: a stopped DAW that cannot come home is a
  // playhead you chase.
  playBtn.addEventListener('click', () => {
    engineClient?.play();
  });
  stopBtn.addEventListener('click', () => {
    engineClient?.stop();
    engineClient?.seek(0);
  });

  // Seek ONLY on the ruler's seek band (docs/UI-CONVENTIONS.md: all
  // three DAWs reserve the clip area for selection/editing). Clicking a
  // track row selects the track and its chain appears in the Device View.
  tracksContainer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const seekBand = target.closest('[data-role="seek"]') as HTMLElement | null;
    if (seekBand && engineClient) {
      const x = e.clientX - seekBand.getBoundingClientRect().left;
      const sr = project?.getDocument().sampleRate || 48000;
      engineClient.seek(Math.round(Math.max(0, x / TIMELINE.pps) * sr));
      return;
    }
    const trackEl = target.closest('[data-track-id]') as HTMLElement | null;
    if (trackEl) {
      const id = trackEl.getAttribute('data-track-id');
      if (id && id !== selectedTrackId) {
        selectedTrackId = id;
        renderTracks(true);
      }
    }
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
}

// Start
init().catch(console.error);
