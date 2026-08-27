// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Export mixdown (AUDIT-6 quick win 1) : le fil UI manquant vers le rendu
 * offline du moteur. Clic -> RenderRequest -> le moteur rend sur SON thread
 * ouvrier (jamais sa boucle de controle, lecon C1) et publie le WAV au
 * store -> DONE {wavHash} -> on telecharge /assets/<hash> (Bearer si
 * #stoken) et on tend le fichier au navigateur.
 *
 * REFUS VISIBLE (modele BOX, regle des effets annonces) : moteur
 * deconnecte, export deja en cours, rendu en echec ou store muet = flash
 * rouge + pastille engine + title explicite. Jamais un clic dans le vide.
 */

import { ctx, PROJECT_ID, SERVER_HTTP, assetAuthHeaders } from './context';
import { RenderState_Status } from '../network/engine_client';
// Garde de projet (incident 2026-08-27 « onglet vide, export qui sonne ») :
// exporter rendrait le projet DU MOTEUR, pas celui de l'onglet - refuser
// visiblement le desaccord plutot que livrer un WAV surprise.

const HEX64 = /^[0-9a-f]{64}$/;

export function wireExport(): void {
  const btn = document.getElementById('export-btn') as HTMLButtonElement | null;
  const eng = ctx.engineClient;
  if (!btn || !eng) return;
  const idleLabel = btn.textContent ?? 'WAV';
  let reqSeq = 0;  // ceinture : perime les timeouts des demandes passees

  const refuse = (why: string): void => {
    btn.classList.remove('refused');
    void btn.offsetWidth;  // relancer l'animation
    btn.classList.add('refused');
    btn.title = why;
    document.getElementById('engine-status')?.classList.add('attention');
    setTimeout(() => document.getElementById('engine-status')
      ?.classList.remove('attention'), 2000);
  };

  const setBusy = (busy: boolean): void => {
    btn.classList.toggle('busy', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.textContent = busy ? 'RENDU…' : idleLabel;
  };

  btn.addEventListener('click', () => {
    if (btn.classList.contains('busy')) return;  // un export a la fois
    if (!eng.isConnected()) {
      refuse('MOTEUR NON CONNECTE - la pastille engine est rouge. '
        + 'Relancer start-daw.cmd ou recharger la page (F5).');
      return;
    }
    const enginePid = eng.engineProjectId();
    if (enginePid && enginePid !== PROJECT_ID) {
      refuse(`Le moteur joue « ${enginePid} », cet onglet montre `
        + `« ${PROJECT_ID} » : l'export sortirait l'AUTRE projet. `
        + 'Utiliser le bandeau pour rejoindre le projet du moteur.');
      return;
    }
    setBusy(true);
    btn.title = 'Rendu offline en cours (moteur)…';
    const myReq = ++reqSeq;
    eng.renderRequest();
    // Ceinture : moteur mort entre isConnected() et l'envoi = aucun
    // RenderState ne reviendra - rendre la main, dire pourquoi.
    window.setTimeout(() => {
      if (myReq === reqSeq && btn.classList.contains('busy')) {
        setBusy(false);
        refuse('Aucune reponse du moteur en 60 s (voir la console).');
      }
    }, 60000);
  });

  eng.onRenderState = async (st) => {
    if (st.status === RenderState_Status.STARTED) return;  // deja busy
    reqSeq++;  // toute fin (DONE/FAILED) perime le timeout en vol
    if (st.status === RenderState_Status.FAILED) {
      setBusy(false);
      console.error('export mixdown FAILED:', st.error);
      refuse(`Export refuse : ${st.error || 'raison inconnue'}`);
      return;
    }
    if (!HEX64.test(st.wavHash)) {  // hygiene B5 : hash -> chemin/URL
      setBusy(false);
      refuse(`Export : hash inattendu du moteur (${st.wavHash.slice(0, 12)})`);
      return;
    }
    try {
      const res = await fetch(`${SERVER_HTTP}/assets/${st.wavHash}`, {
        headers: assetAuthHeaders(),
      });
      if (!res.ok) throw new Error(`store HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${PROJECT_ID}-mixdown.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setBusy(false);
      btn.title = `Exporte : ${st.lengthSamples} samples @ ${st.sampleRate} Hz, `
        + `${st.bitDepth}-bit (sha ${st.wavHash.slice(0, 8)}…). `
        + 'Re-cliquer pour re-exporter.';
      // Sonde de pilotage (modele __dawSessionSlots) : les specs lisent
      // le DERNIER export sans dependre de l'evenement download.
      (window as unknown as { __dawLastExport?: unknown }).__dawLastExport = {
        wavHash: st.wavHash, lengthSamples: st.lengthSamples,
        sampleRate: st.sampleRate, bitDepth: st.bitDepth,
      };
    } catch (e) {
      setBusy(false);
      refuse(`WAV rendu mais telechargement du store en echec : ${String(e)}`);
    }
  };
}
