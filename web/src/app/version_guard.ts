// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Garde de version (2026-08-27, demande utilisateur : « ca m'arrive trop
 * souvent d'ouvrir un onglet qui est une vieille version du site » ; puis
 * « unifier et mettre a jour les onglets ouverts en permanence »).
 *
 * Le serveur de dev expose /api/version = l'identite de SON processus.
 * L'onglet memorise la premiere valeur vue puis interroge toutes les 10 s :
 * une valeur DIFFERENTE = la stack a ete relancee sous cet onglet (son
 * code est peut-etre perime) -> il se RECHARGE seul. Le document ne perd
 * rien (CRDT au serveur) ; seul l'historique d'undo local (volatile par
 * nature) repart a zero - le prix, assume, d'un onglet qui ne ment jamais.
 *
 * Endpoint absent (prod sans middleware) ou stack eteinte : silence,
 * jamais de reload sur une erreur reseau.
 */

const POLL_MS = 10_000;

export function wireVersionGuard(): void {
  let baseline: string | null = null;

  const check = async (): Promise<void> => {
    let v: string | null = null;
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;  // endpoint absent (prod) : garde muette
      v = String((await res.json() as { v?: unknown }).v ?? '');
    } catch {
      return;  // stack eteinte / reseau : ne JAMAIS recharger sur un doute
    }
    if (!v) return;
    if (baseline === null) { baseline = v; return; }
    if (v !== baseline) {
      console.warn(`[version-guard] nouvelle version du site (${baseline} -> ${v}) : rechargement`);
      location.reload();
    }
  };

  void check();
  window.setInterval(() => { void check(); }, POLL_MS);
}
