# Test des mains — jalon 2.4

*Prealable OBLIGATOIRE a la session de re-cadrage 2.5 (TODO). Les notes
brutes prises ici sont un INTRANT de l'arbitrage etat/decouverte/fenetrage.
Le systeme a ete concu pour survivre a tout ce qui suit — c'est la premiere
fois qu'un humain le lui demande.*

## Mise en place (3 terminaux + le script de seed, une fois)

```powershell
# Terminal 1 — serveur
cd C:\Users\mb668\daw-project\server
cargo run --release

# Terminal 2 — web
cd C:\Users\mb668\daw-project\web
npm run dev

# Terminal 3 — generer le doc/ton (30 s) puis seeder le projet 'default'
cd C:\Users\mb668\daw-project\engine\build-msvc
.\create_test_doc.exe ..\test-assets\mains.am ..\test-assets 30
cd C:\Users\mb668\daw-project\web
node scripts\seed-again.mjs --base ..\engine\test-assets\mains.am --assets ..\engine\test-assets

# Terminal 3 — le moteur, branche au serveur, AGain resolu par UID
cd C:\Users\mb668\daw-project\engine\build-msvc
.\daw_engine.exe --server ws://localhost:3000 --project default --play `
  --assets ..\test-assets `
  --vst3-module 84E8DE5F92554F5396FAE4133C935A18=VST3\Release\again.vst3
```

Onglet : `http://localhost:5173/?token=<champ "token" du JSON
%TEMP%\daw-engine-token-47821>` — le fichier est PAR PORT depuis le
2026-08-22 et contient `{token, port, address}` ; ne colle que la valeur
du champ `token`. (Le token ne sert qu'a la telemetrie moteur ; sans
lui, le son marche, les meters non.)

Alternative sans copier-coller : `scripts\daw.ps1` monte toute la stack
et ouvre le navigateur avec le token deja dans l'URL (projet `studio`).
Ce runbook garde la voie manuelle pour rester au plus pres des organes.

Tu dois voir : une piste avec un fader, une ligne de chain `vst3` avec un
bouton **bypass**, et entendre le ton a mi-volume (AGain a 0,5).

## La checklist de l'utilisateur impatient

Dans l'ordre ou dans le desordre — note TOUT, meme l'inexplicable, en vrac
en bas de ce fichier ou ailleurs. Les notes brutes valent mieux que les
notes propres.

1. **Martele le bypass** pendant la lecture. Chaque clic doit s'entendre
   (plein volume <-> moitie). L'affichage du bouton ne se pose qu'au
   retour du document — un decalage visible ? note-le.
2. **Bouge le fader EN MEME TEMPS** que tu marteles. Deux chemins de
   changement simultanes vers le meme moteur.
3. **Tue `plugin_host.exe` dans le gestionnaire de taches** pendant la
   lecture. Attendu : le son passe en sec SANS artefact, le moteur log la
   relance a froid (budget 3), le son traite revient seul. Chronometre au
   ressenti la fenetre de silence de traitement.
4. **Re-tue-le 3 fois de suite** : au 4e, bypass permanent signale —
   le moteur doit rester vivant et le dire.
5. **Ferme le serveur (Ctrl+C terminal 1), continue de jouer.** Le moteur
   et le son doivent survivre. Rouvre le serveur : la reconnexion et la
   convergence doivent etre invisibles.
6. **Deux onglets** : le bypass clique dans l'un doit s'afficher dans
   l'autre (aucun des deux ne l'invente — c'est le document qui decide).
7. **Ferme tout salement** (croix sur les terminaux). Verifie au
   gestionnaire de taches : AUCUN `plugin_host.exe` orphelin ne doit
   survivre (garde parent).
8. **MISSION AUDIT-3 (ajoutee 2026-08-22) : varie la taille de buffer.**
   Dans le panneau de la Zen Go, change la taille de buffer : **256**,
   puis **1024** (ou une valeur non standard si le driver le permet),
   en relancant le moteur a chaque fois. Le rapport AUDIT-3 predit :
   a 512 tout passe ; a 1024 le pipeline est clampe en silence (A3-2,
   blocs secs massifs attendus) ; a une periode non multiple de 256 le
   plugin devient partiellement muet en permanence (A3-3). Note le
   buffer affiche par le moteur au demarrage, le compteur « blocks
   missed » a l'arret, et ce que tes oreilles disent. C'est le rare cas
   ou le test des mains et l'audit se valident mutuellement — fais
   mentir le ZenGo-a-512.

## Notes brutes

(a remplir a la main — tout compte, surtout ce qui agace)
