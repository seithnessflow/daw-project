# Decisions and Test Results

## Build Natif Windows - 2026-08-20

### Critère 1: Hash Identique
**REUSSI**

Le build MSVC produit le même hash de rendu que le build GCC:
```
Hash: f40af882097b704a
```

Vérification:
- GCC (WSL): `f40af882097b704a`
- MSVC (Windows): `f40af882097b704a`

Cela confirme:
- Pas de comportement indéfini (mémoire non initialisée)
- Calculs flottants cohérents entre compilateurs
- Sérialisation Automerge déterministe

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
