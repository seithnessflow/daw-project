# Decisions and Test Results

## Critere 1: nouveau hash de reference - 2026-08-21

**L'ancien hash `f40af882097b704a` etait un hash de SILENCE. Ne plus s'y referer.**

Le fixture de `testRenderDeterminism` etait un document sans clip: le rendu
etait 1 seconde de silence, et l'egalite GCC/MSVC ne prouvait rien du chemin
audio. (Ce meme fixture silencieux a masque pendant des semaines un bug du
renderer hors-ligne qui rendait du silence pour tout document reel - corrige
le 2026-08-21, commit `4cb1491`.)

Nouveau fixture (genere par le test, deterministe inter-compilateurs car sans
`sin()` de libm): deux pistes a gains differents (0.8 / 0.3), onde carree
stereo + dent-de-scie mono, clips chevauchants, un offset non nul. Le test
verifie que le rendu n'est PAS silencieux (peaks > 0.05) puis compare au
hash de reference.

```
Hash de reference: 89f1a1105dc09e92
```

- MSVC (Windows natif): `89f1a1105dc09e92` (verifie 2026-08-21)
- GCC (CI Linux): a confirmer au premier run CI apres le commit

Toute deviation fait echouer `daw_engine_test` (CI comprise). Mise a jour du
hash uniquement pour un changement de rendu delibere et documente ici.

## Build Natif Windows - 2026-08-20

### Critère 1: Hash Identique
**REUSSI** *(hash invalide depuis 2026-08-21: c'etait un hash de silence, voir ci-dessus)*

Le build MSVC produit le même hash de rendu que le build GCC:
```
Hash: f40af882097b704a   (OBSOLETE - rendu silencieux)
```

Vérification:
- GCC (WSL): `f40af882097b704a`
- MSVC (Windows): `f40af882097b704a`

Cela confirme:
- Sérialisation Automerge déterministe
- (La coherence des calculs flottants n'etait PAS prouvee: le rendu etait silencieux)

### Critère 5: WASAPI Temps Réel
**PARTIELLEMENT VÉRIFIÉ**

#### Test effectué (2026-08-20)

| Paramètre | Valeur |
|-----------|--------|
| Device | ZenGo SC USB Audio Driver Playback 1/2 |
| Sample Rate | 48000 Hz |
| Buffer Size | 512 frames |
| Latency | ~10.67 ms |
| Duration | 599.56 s / 600 s |
| Underruns | **0** |
| Peak L/R | 0.124985 |
| Charge CPU | **ABSENTE** |

**Verdict**: Le test a tourné 10 minutes sans underrun, mais **sans charge CPU parallèle**.
Le critère n'est pas validé tant qu'un test avec charge (recompilation du projet) n'est pas effectué.

#### Bug corrigé (2026-08-20)
- `addTrack()` sérialise maintenant les clips correctement
- Test round-trip ajouté (`testDocumentClipsRoundTrip`)
- 8 tests passent dont sérialisation clips

#### Pour valider le critère
```powershell
# Terminal 1: Charge CPU (recompilation)
cd engine\build-msvc
ninja clean && ninja -j8

# Terminal 2: Lecture audio (lancer avant la recompilation)
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821
```

Observer le compteur Underruns pendant toute la durée. Zéro = critère validé.

### Critère 4: Chrome LNA
**EN COURS**

Page de test disponible:
```
https://lunch-matrix-given-somebody.trycloudflare.com/
```

Issue WebSocket:
```
SocketServer::listen() error calling setsockopt(SO_REUSEADDR)
```
IXWebSocket échoue sur Windows. Le serveur HTTP fonctionne mais pas le WebSocket.

Pour compléter le test LNA:
1. Ouvrir l'URL dans Chrome >= 142
2. Observer si une invite LNA apparaît lors de:
   - "Test Fetch" → requête vers http://127.0.0.1:9000
   - "Test WebSocket" → connexion vers ws://127.0.0.1:9000
3. Tester comportement sur refus
4. Vérifier si le refus est mémorisé
5. **Documenter comment annuler un refus**

Questions à répondre:
- [ ] L'invite LNA apparaît-elle pour fetch?
- [ ] L'invite LNA apparaît-elle pour WebSocket?
- [ ] Le refus est-il mémorisé (après reload)?
- [ ] Comment l'utilisateur peut-il revenir en arrière après un refus?

---

## Procédure de Build Windows

Voir ADR-015 pour la procédure complète.

Résumé:
1. Visual Studio Build Tools 2022 (installation utilisateur)
2. Rust avec cible `x86_64-pc-windows-msvc`
3. Git portable (pour FetchContent)
4. Build automerge-c: `cargo build --release --target x86_64-pc-windows-msvc -p automerge-c`
5. CMake avec Ninja

---

## Issues Résolues

### ✅ addTrack ne copiait pas les clips
**CORRIGÉ** - `automerge_document.cpp` sérialise maintenant tous les champs des clips.

---

## Issues Ouvertes

### Résolues (2026-08-20)
1. **IXWebSocket sur Windows** - CORRIGÉ
   - Problème 1: `ix::initNetSystem()` non appelé (WSAStartup manquant)
   - Problème 2: SO_REUSEADDR échoue sur Windows (patché pour ignorer)
   - Port 9000 occupé par wslrelay.exe → utiliser port 47821
   - Solution: `--ws-port 47821`

2. **Sélection périphérique audio** - AJOUTÉ
   - `--list-devices` pour lister les périphériques
   - `--device <name>` pour sélectionner par nom (substring match)

### Moyenne Priorité
2. **Test LNA** - Nécessite validation manuelle dans navigateur

---

## Prochaines Étapes

1. ~~Corriger `addTrack` pour copier les clips~~ ✅
2. Tester critère 5 (WASAPI 10 min) avec le nouveau document
3. Investiguer SO_REUSEADDR avec port 47821
4. Compléter le test LNA manuellement
5. Build Windows natif dans CI
