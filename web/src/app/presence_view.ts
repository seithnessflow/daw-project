// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Renders the presence overlay: a roster of who is here (topbar) and a
 * coloured flag on each track a remote peer has selected. Pure DOM, driven
 * by Presence.onChange and re-applied after every renderTracks (which
 * rebuilds the heads and so wipes the flags).
 */

import type { Presence } from '../network/presence';

export function renderPresence(presence: Presence): void {
  renderRoster(presence);
  renderRemoteSelections(presence);
}

/** A small coloured dot with the peer's name as tooltip. */
function dot(color: string, label: string, title: string): HTMLElement {
  const d = document.createElement('span');
  d.className = 'peer-dot';
  d.style.setProperty('--peer', color);
  d.title = title;
  d.textContent = label;
  return d;
}

function renderRoster(presence: Presence): void {
  let roster = document.getElementById('presence-roster');
  if (!roster) {
    roster = document.createElement('div');
    roster.id = 'presence-roster';
    roster.className = 'status-item presence-roster';
    // Front of the status cluster so collaborators read first.
    document.querySelector('.status')?.prepend(roster);
  }
  roster.replaceChildren();
  // Self first, marked, so you recognise your own colour on the heads.
  roster.appendChild(dot(presence.myColor, presence.myName[0], `${presence.myName} (toi)`));
  const peers = presence.list().sort((a, b) => a.id.localeCompare(b.id));
  for (const p of peers) {
    roster.appendChild(dot(p.color, p.name[0], p.name));
  }
  roster.classList.toggle('presence-alone', peers.length === 0);
}

function renderRemoteSelections(presence: Presence): void {
  // Clear the previous frame's flags, then re-place them.
  for (const old of document.querySelectorAll('.peer-flags')) old.remove();
  const tracks = document.querySelectorAll<HTMLElement>('.track[data-track-id]');
  for (const trackEl of tracks) {
    const id = trackEl.dataset.trackId;
    if (!id) continue;
    const peers = presence.onTrack(id);
    if (peers.length === 0) continue;
    const flags = document.createElement('div');
    flags.className = 'peer-flags';
    for (const p of peers) {
      const f = document.createElement('span');
      f.className = 'peer-flag';
      f.style.setProperty('--peer', p.color);
      f.title = `${p.name} edite cette piste`;
      f.textContent = p.name;
      flags.appendChild(f);
    }
    // In flow, right after the track name - never over the M/S buttons.
    const name = trackEl.querySelector('.track-name');
    if (name) name.after(flags);
    else trackEl.querySelector('.track-head')?.appendChild(flags);
  }
}
