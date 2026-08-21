/**
 * DAW Web Client - Slice 1
 *
 * Minimal UI for testing sync and engine communication.
 */

import { Project } from './document/project';
import { ServerClient } from './network/server_client';
import { EngineClient } from './network/engine_client';
import { createTrackUI, updateMeter } from './ui/track';
import { formatTime } from './ui/transport';

// Configuration
const SERVER_URL = 'ws://localhost:3000';
const ENGINE_URL = 'ws://127.0.0.1:9000';
const PROJECT_ID = 'default';

// State
let project: Project | null = null;
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
  serverClient.onDocument = (data) => {
    project!.load(data);
    renderTracks();
  };
  serverClient.onChange = (change) => {
    project!.applyChange(change);
    renderTracks();
  };

  // Connect to engine
  engineClient = new EngineClient(ENGINE_URL);
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
  tracksContainer.innerHTML = '';

  for (const track of doc.tracks) {
    const element = createTrackUI(track, (gain) => {
      // Update local document
      project!.setTrackGain(track.id, gain);

      // Send change to server
      const change = project!.getLastChange();
      if (change && serverClient) {
        serverClient.sendChange(change);
      }

      // Send to engine
      engineClient?.setGain(track.id, gain);
    });
    tracksContainer.appendChild(element);
  }
}

// Start
init().catch(console.error);
