# ADR-015: Windows Native Build

*Statut : VIVANT (la decision). La PROCEDURE ci-dessous est historique
(2026-08-20 : chemins `build/_deps/automerge-src`, hash `f40af882` — un
hash de silence depuis invalide) : la recette de build en vigueur est
`engine\rebuild_msvc.bat` (CLAUDE.md §13) et, pour les pins, `ci.yml`.
Collision de numero : le chapitre « ADR-015 WSL » de DECISIONS.md est
l'ancienne decision que celle-ci remplace.*

## Status
Accepted

## Context
The DAW engine was initially developed under WSL2 with GCC. However:
- Criterion 5 (WASAPI real-time stability) cannot be validated under WSLg
- Criterion 4 (LNA) requires the engine on Windows loopback (127.0.0.1)
- WSL2 has its own network namespace, invisible from Windows Chrome

A native Windows build with MSVC is required to validate both criteria.

## Decision
Build natively on Windows using:
- Visual Studio Build Tools 2022 (user installation, no admin)
- CMake + Ninja (bundled with VS Build Tools)
- Rust toolchain with MSVC target
- FetchContent for dependencies (not vcpkg)

## Build Procedure

### Prerequisites (one-time)

1. **Install Visual Studio Build Tools** (no admin required):
   ```powershell
   # Download installer
   Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile "$env:TEMP\vs_BuildTools.exe"

   # Install C++ tools + CMake
   Start-Process -Wait "$env:TEMP\vs_BuildTools.exe" -ArgumentList @(
       '--add', 'Microsoft.VisualStudio.Workload.VCTools',
       '--add', 'Microsoft.VisualStudio.Component.VC.CMake.Project',
       '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.22621',
       '--installPath', "$env:LOCALAPPDATA\Microsoft\VisualStudio\BuildTools",
       '--passive'
   )
   ```

2. **Install Rust for MSVC**:
   ```powershell
   Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile "$env:TEMP\rustup-init.exe"
   & "$env:TEMP\rustup-init.exe" -y --default-host x86_64-pc-windows-msvc
   ```

3. **Install Git** (for FetchContent):
   ```powershell
   $gitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.45.2.windows.1/PortableGit-2.45.2-64-bit.7z.exe'
   Invoke-WebRequest -Uri $gitUrl -OutFile "$env:TEMP\PortableGit.7z.exe"
   & "$env:TEMP\PortableGit.7z.exe" -o "$env:LOCALAPPDATA\Git" -y
   ```

### Build automerge-c for MSVC

The automerge monorepo must be compiled for the MSVC target:

```powershell
cd C:\Users\mb668\daw-project\build\_deps\automerge-src\rust

# Remove stale workspace lock
Remove-Item Cargo.lock -ErrorAction SilentlyContinue

# Build automerge-c for MSVC
cargo build --release --target x86_64-pc-windows-msvc -p automerge-c
```

Output: `target/x86_64-pc-windows-msvc/release/automerge_core.lib`

### Build Engine

```powershell
$vsPath = "$env:LOCALAPPDATA\Microsoft\VisualStudio\BuildTools"
$cmakePath = "$vsPath\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
$vcvarsPath = "$vsPath\VC\Auxiliary\Build\vcvars64.bat"
$gitDir = "$env:LOCALAPPDATA\Git\cmd"

$buildDir = "C:\Users\mb668\daw-project\engine\build-msvc"

# Configure
cmd /c "set PATH=%PATH%;$gitDir && `"$vcvarsPath`" x64 && cd /d `"$buildDir`" && `"$cmakePath`" -G Ninja -DCMAKE_BUILD_TYPE=Release .."

# Build
cmd /c "set PATH=%PATH%;$gitDir && `"$vcvarsPath`" x64 && cd /d `"$buildDir`" && `"$cmakePath`" --build . --parallel"
```

### Verify Build

```powershell
.\build-msvc\daw_engine_test.exe
```

Expected output:
```
=== DAW Engine Integration Tests ===

Test: Document creation... OK
Test: Track management... OK
Test: Audio graph construction... OK
Test: Gain node processing... OK
Test: SPSC ring buffer... OK
Test: Document serialization... OK
Test: Render determinism... OK (hash: f40af882097b704a)

=== Results ===
Passed: 7
Failed: 0
```

**CRITICAL**: The hash `f40af882097b704a` must match the Linux/GCC build. This confirms:
- Identical rendering across compilers
- No uninitialized memory issues
- Consistent floating-point behavior

## CMake Changes

The CMakeLists.txt was modified to support both platforms:

1. **Runtime library policy** (before project()):
   ```cmake
   cmake_policy(SET CMP0091 NEW)
   if(WIN32 OR MSVC)
       set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL" CACHE STRING "" FORCE)
   endif()
   ```

2. **Protobuf runtime fix**:
   ```cmake
   set(protobuf_MSVC_STATIC_RUNTIME OFF CACHE BOOL "" FORCE)
   set(ABSL_MSVC_STATIC_RUNTIME OFF CACHE BOOL "" FORCE)
   ```

3. **Platform-specific automerge path**:
   ```cmake
   if(WIN32)
       set(AUTOMERGE_LIB_PATH "${AUTOMERGE_MONOREPO_DIR}/rust/target/x86_64-pc-windows-msvc/release/automerge_core.lib")
   else()
       set(AUTOMERGE_LIB_PATH "${AUTOMERGE_BUILD_DIR}/libautomerge.a")
   endif()
   ```

4. **Windows link libraries**:
   ```cmake
   if(WIN32)
       target_link_libraries(daw_engine_lib PUBLIC
           ws2_32 wsock32 userenv bcrypt ntdll
       )
   endif()
   ```

## Consequences

### Positive
- Both criteria 4 and 5 can be validated
- Cross-compiler hash verification confirms code correctness
- No vcpkg dependency, simpler CI

### Negative
- Two build configurations to maintain
- Rust must be recompiled for each target
- WebSocket server has socket issues on Windows (needs investigation)

## Notes

### WebSocket Issue
The IXWebSocket server fails with:
```
SocketServer::listen() error calling setsockopt(SO_REUSEADDR)
```
This appears to be a Windows-specific issue. Audio playback works without WebSocket.

### Audio Device
Test performed with ZenGo SC USB Audio Driver:
- Sample Rate: 48000 Hz
- Buffer Size: 512 frames (~10.7ms latency)
