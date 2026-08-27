// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Garde de projet (2026-08-27, incident « rien dans l'arrangement et
 * pourtant l'export m'a sorti un sample » : l'onglet montrait un projet,
 * le moteur en jouait un autre - deux verites, aucune annoncee).
 *
 * Deux organes :
 * 1. Le BADGE : la topbar dit toujours QUEL projet cet onglet montre.
 * 2. Le BANDEAU : le moteur diffuse son project_id (EngineState 30 Hz) ;
 *    s'il differe du ?project= de l'onglet, bandeau visible + bouton
 *    « Ouvrir <projet du moteur> » (le hash #stoken est conserve).
 *    On ANNONCE, on ne bascule jamais tout seul (regle des effets).
 */

import { ctx, PROJECT_ID } from './context';

const POLL_MS = 1000;

export function wireProjectGuard(): void {
  const badge = document.getElementById('project-badge');
  if (badge) {
    badge.textContent = PROJECT_ID;
    badge.title = `Cet onglet montre le projet « ${PROJECT_ID} »`;
  }

  const banner = document.getElementById('project-banner');
  if (!banner) return;

  let shownFor = '';  // ne reconstruire le bandeau qu'au changement
  window.setInterval(() => {
    const enginePid = ctx.engineClient?.engineProjectId() ?? '';
    const mismatch = enginePid !== '' && enginePid !== PROJECT_ID;
    if (!mismatch) {
      if (shownFor) { banner.hidden = true; shownFor = ''; }
      return;
    }
    if (shownFor === enginePid) return;
    shownFor = enginePid;
    banner.replaceChildren();
    const txt = document.createElement('span');
    txt.textContent = `Le moteur joue « ${enginePid} » — cet onglet montre `
      + `« ${PROJECT_ID} ».`;
    // ACTION PRIMAIRE (le moteur suit l'onglet, 2026-08-27) : ramener le
    // moteur ICI. Le bandeau s'eteint tout seul quand la telemetrie dit
    // que ca matche ; en attendant, le bouton annonce la bascule.
    const claim = document.createElement('button');
    claim.dataset.role = 'engine-follow';
    claim.textContent = `Jouer « ${PROJECT_ID} » ici`;
    claim.addEventListener('click', () => {
      claim.disabled = true;
      claim.textContent = 'bascule du moteur…';
      ctx.engineClient?.switchProject(PROJECT_ID);
    });
    const go = document.createElement('button');
    go.className = 'secondary';
    go.textContent = `Ouvrir « ${enginePid} »`;
    go.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('project', enginePid);  // hash #stoken conserve
      window.location.href = url.toString();
    });
    banner.append(txt, claim, go);
    banner.hidden = false;
  }, POLL_MS);
}
