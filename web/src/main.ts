// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * DAW Web Client - Slice 1
 *
 * Minimal UI for testing sync and engine communication.
 */

import { Project } from './document/project';
import { ServerClient } from './network/server_client';
import { EngineClient } from './network/engine_client';
import { createTrackUI, updateMeter, updateTrackGainUI } from './ui/track';
import { formatTime } from './ui/transport';

// Configuration
const SERVER_URL = 'ws://localhost:3000';
const ENGINE_PORT = 47821;
// Project id can be overridden via ?project=<id> (used by E2E tests to get
// an isolated project per run)
const PROJECT_ID =
  new URLSearchParams(window.location.search).get('project') ?? 'default';

// State
let project: Project | null = null;

// Expose for E2E testing diagnostics
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
const addTrackBtn = document.getElementById('add-track-btn') as HTMLButtonElement;

/**
 * Initialize the application.
 */
async function init() {
  console.log('DAW Web Client starting...');

  // Create project document
  project = new Project();
  window.__dawProject = project; // Expose for E2E diagnostics

  // Connect to server
  serverClient = new ServerClient(SERVER_URL);
  serverClient.onConnect = () => {
    serverStatus.classList.add('connected');
    console.log('Connected to server');
  };
  serverClient.onDisconnect = () => {
    serverStatus.classList.remove('connected');
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
      // Anti-entropy: the server broadcasts changes BEFORE persisting them,
      // so a reconnection can both miss a peer's live flush and read a
      // stale stored document. Whenever an exchange moved anything
      // (novelty received or queued changes flushed), demand TWO
      // consecutive no-op exchanges before stopping the verification
      // cycles: a peer's late flush can land while we are mid-cycle.
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

  // Connect to engine
  // Token is read from URL query param or can be set via engineClient.setToken()
  // Engine writes token to %TEMP%/daw-engine-token
  const urlParams = new URLSearchParams(window.location.search);
  const engineToken = urlParams.get('token') ?? '';
  engineClient = new EngineClient({ port: ENGINE_PORT, token: engineToken });
  engineClient.onConnect = () => {
    engineStatus.classList.add('connected');
    playBtn.disabled = false;
    stopBtn.disabled = false;
    console.log('Connected to engine');
  };
  engineClient.onDisconnect = () => {
    engineStatus.classList.remove('connected');
    playBtn.disabled = true;
    stopBtn.disabled = true;
    console.log('Disconnected from engine');
  };
  engineClient.onPosition = (samples, sampleRate) => {
    positionEl.textContent = formatTime(samples, sampleRate);
  };
  engineClient.onMeters = (meters) => {
    for (const { trackId, peakLeft, peakRight } of meters) {
      updateMeter(trackId, Math.max(peakLeft, peakRight));
    }
  };

  // Transport buttons
  playBtn.addEventListener('click', () => {
    engineClient?.play();
  });
  stopBtn.addEventListener('click', () => {
    engineClient?.stop();
  });

  // Add track button
  addTrackBtn.addEventListener('click', () => {
    if (!project) return;

    const trackCount = project.getDocument().tracks.length;
    const newTrack = {
      id: `track-${Date.now()}`,
      name: `Track ${trackCount + 1}`,
      gain: 1.0,
      clips: [],
      chain: [],
    };

    project.addTrack(newTrack);

    // Send change to server
    const change = project.getLastChange();
    if (change && serverClient) {
      serverClient.sendChange(change);
    }

    renderTracks();
  });

  // Start connections
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
 * Render track UI from project document.
 */
function renderTracks() {
  if (!project) return;

  const doc = project.getDocument();

  // Same track structure -> update gains in place. A full innerHTML rebuild
  // on every received change (30/s during a remote drag) thrashes the DOM
  // and would yank the slider out of the local user's hand.
  const existing = Array.from(
    tracksContainer.querySelectorAll('[data-track-id]')
  ).map((e) => e.getAttribute('data-track-id'));
  const sameStructure =
    existing.length === doc.tracks.length &&
    doc.tracks.every((t, i) => existing[i] === t.id);

  if (sameStructure) {
    for (const track of doc.tracks) {
      updateTrackGainUI(track.id, track.gain);
    }
    return;
  }

  tracksContainer.innerHTML = '';

  for (const track of doc.tracks) {
    const element = createTrackUI(track, (gain) => {
      console.log('onGainChange called:', track.id, gain);
      // Update local document
      project!.setTrackGain(track.id, gain);

      // Send change to server - engine will receive it via server subscription
      const change = project!.getLastChange();
      console.log('Change generated:', change ? `${change.length} bytes` : 'null');
      if (change && serverClient) {
        console.log('Sending change to server...');
        serverClient.sendChange(change);
        console.log('Change sent');
      } else {
        console.log('Not sending - change:', !!change, 'serverClient:', !!serverClient);
      }
    });
    tracksContainer.appendChild(element);
  }
}

// Start
init().catch(console.error);
