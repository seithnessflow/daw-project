# REPRISE.md — point de reprise au demarrage

*Ecrit le 2026-08-25 (fin de journee, sessions 1-2-3 de l'ordre grave).
VOLATILE : etat dans STATUS.md, file dans TODO.md, recit dans
JOURNAL.md.*

## Ou on en est (30 secondes)

L'ORDRE GRAVE du recadrage est execute dans l'ordre :
1. [x] CRASH 0xe06d7363 : cause (envoi sous verrou + Close synchrone
   ixwebsocket = self-lock), fix (envoi hors verrou), contre-epreuve
   60/60 (scripts/crash-churn.cjs), handler auto-symbolisant.
2. [x] GTESTS LOCAUX : 29/29 retablis (bundle SDK OFF epingle,
   fixtures plates VST3\again.vst3, refs reconciliees).
3. [~] INVARIANT SUR VRAIS PLUGINS — moitie locale COMPLETE :
   - PREUVE : scripts/invariant-proof.ps1 (quatuor) — rendu reel x2
     bit-deterministe, pair-sans-plugin = MEMES OCTETS via
     « playing STEM », bidon = echec bruyant. VERT sur inv-proof
     (Valhalla + RoughRider).
   - PDC ECRIVAIN : ring v7 (latence interne declaree par l'enfant),
     le stem declare la somme de sa chaine ; lecteur deja gteste.
   - FRAICHEUR (arbitrage b, interprete d'un « OK » — a infirmer si
     faux) : sf:1 / 2 s sur le canal ephemere, badge 3 etats,
     « fraicheur inconnue » au silence ; stem-freshness.spec verte.
   gtests 29/29, e2e 36/36, CI verte jusqu'a 55fcac8 (1c61c6c en
   sentinelle — premier point de synchro si absent).

## RESTE DE LA SESSION 3 — la jambe deux machines

LE PORTABLE DOIT PULL + REBUILD AVANT TOUTE SEANCE (fix crash + ring
v7 : un enfant v7 refuse un segment v6 et vice-versa). Puis :
scripts/invariant-proof.ps1 jambe SANS chez lui (il n'a aucun de ces
plugins) + badges de fraicheur observes depuis la-bas.

## Relancer

- Banc : moteur ma-piece 47821 (audible, --start-stopped, --editors,
  catalogue scanne) tourne ; onglets localhost:5173/?project=ma-piece.
- Moteur de preuve : inv-proof sur 47831 (muet) — relancer au besoin,
  memes flags + --vst3-dir.
- Preuves rejouables : scripts/invariant-proof.ps1,
  scripts/crash-churn.cjs, npm run ear -- --project X [--vst3 uid=path].

## A surveiller

- Piege ARGV grave dans les scripts : \a en JS MANGE le backslash —
  chemins en SLASHES AVANT dans tout script de test.
- Les chemins --vst3-module relatifs se resolvent contre l'EXE
  desormais (jamais le cwd) ; mapping logue verbatim au demarrage.
- Sonde soothe2 (latence lookahead reelle) pendue (licence ?) — a
  re-tenter pour une preuve PDC non-nulle.

## La suite (ordre grave)

3-fin. Jambe deux machines (ci-dessus).
4.1 [x] UTILITY + chassis natif FAIT (gtest exact, -6.02 dB bout-en-bout).
4.2 EQ 3 bandes + compresseur = LA SUIVANTE.
4. Effets natifs (3 sessions, VCV Rack).
5. Vague 3 (test ultime Massive).
6. AUDIT-5 harmonisation (souhait utilisateur, consigne).
