# ADR-016: Automerge Version Alignment

**Date:** 2026-08-20
**Status:** Accepted

## Context

The DAW project uses Automerge CRDT across three tiers:
- Engine (C++): automerge-c
- Server (Rust): automerge crate
- Web (TypeScript): @automerge/automerge

A version audit revealed:
- Engine used automerge-c 0.3.0 (depends on automerge 0.11.0 from monorepo)
- Server used automerge 0.5.12 (crates.io)
- Web declared ^2.1.0 but resolved to 2.2.9

The concern was binary format compatibility. Testing confirmed:
- automerge 0.5.12 successfully loads documents from 0.11.0
- The binary format is identical (magic header `85 6f 4a 83`)
- This is an API evolution, not a format change

## Decision

1. **Pin all three tiers to explicit versions:**

   | Tier | Package | Version | Source |
   |------|---------|---------|--------|
   | Engine | automerge-c | 0.3.0 | monorepo commit `47908d6c` |
   | Server | automerge (crate) | =0.11.0 | crates.io |
   | Web | @automerge/automerge | 2.2.9 | npm |

2. **Rule:** Any upgrade of Automerge must happen on all three tiers simultaneously, never one alone.

3. **Web WASM configuration:**
   - Uses `vite-plugin-wasm` for Vite compatibility
   - `optimizeDeps.exclude: ['@automerge/automerge']` prevents pre-bundling issues

## Verification

Test performed 2026-08-20:
```bash
# Created test binary with automerge 0.5.12
/tmp/am-test/target/release/am-test test_10min.am
# Result: SUCCESS, keys: ["sampleRate", "schemaVersion", "tracks"]

# Same test with automerge 0.11.0
/tmp/am-test-new/target/release/am-test-new test_10min.am
# Result: SUCCESS, keys: ["sampleRate", "schemaVersion", "tracks"]
```

## Consequences

- Server now uses automerge 0.11.0 (matches engine monorepo)
- Web project.ts rewritten with real Automerge API (was JSON stub)
- All three tiers can now exchange documents and changes
- Criterion 3 (two-tab convergence) is now testable
