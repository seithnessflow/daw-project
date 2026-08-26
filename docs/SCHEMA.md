# Project Document Schema

**Version:** 1
**Format:** Automerge binary (`.am`)
**Source of truth:** This file. All three tiers (engine, server, web) conform to it.

> **v2 announced (ADR-019, 2026-08-23, design session pending):** v2
> adds PLACEMENT — each processing node declares which peer hosts it
> (negotiated by capability) — and rendered-stem references (stem key =
> hash of input audio + class-uid + param state + time range) so a peer
> WITHOUT the plugin plays the plugin's output from the asset store.
> Nothing of this exists in v1 or in code yet; do not build against it
> before the design session lands here.
>
> **Also on the v2 design session's table (consigned 2026-08-25):
> LISTENING PLACES** — each participant has their own listening
> position, movable in one click: **Alone** (strictly local stream:
> sample preview, chain experiments — editing still converges, only
> LISTENING is isolated), **Common** (N local renders of the same
> document — not a shared stream), **At a peer** (hear what they hear,
> local solos/mutes/previews included). The capability exists by
> construction (one engine per machine); it is to be revealed, not
> built. Hard constraints: NONE of it enters this document (listening
> position, mode, local solos, preview selection are performance
> state on the ephemeral channel — the existing rule applies as-is);
> the MODE is visible to others while its CONTENT stays private;
> joining a peer is asked or at least signaled; returning to Common
> breaks neither playback position nor transport. Joining a peer IS
> the stem-streaming transport (one mechanism, hashed slices), and
> the stem freshness badge must hold in Alone mode too. Full brief:
> TODO.md, entry « LIEUX D'ECOUTE » (2bis). Placement and listening
> places are the same subject seen from two sides — decide together.

## Schema v1

```json
{
  "schemaVersion": 1,
  "sampleRate": 48000,
  "tracks": [
    {
      "id": "string (UUID)",
      "name": "string",
      "gain": "float (linear, 0.0 to 2.0)",
      "clips": [
        {
          "id": "string (UUID)",
          "name": "string (optional, display name)",
          "assetHash": "string (SHA-256 hex)",
          "startSample": "int64",
          "lengthSamples": "int64",
          "offsetSamples": "int64",
          "fadeInSamples": "int64 (optional, default 0)",
          "fadeOutSamples": "int64 (optional, default 0)"
        }
      ],
      "chain": [
        {
          "id": "string (UUID)",
          "type": "string",
          "uid": "string (vst3 only: 32-hex VST3 class id)",
          "params": "[ { key: string, value: float } ]"
        }
      ]
    }
  ]
}
```

## Field Specifications

### Root

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `uint32` | Yes | Always present, even in v1. Enables migrations. |
| `sampleRate` | `uint32` | Yes | Project sample rate in Hz. Fixed at 48000 for slice 1. |
| `masterGain` | `float` | No (V1.2, additive) | Root master gain, linear 0.0-2.0. ABSENT on older documents = 1.0 (every consumer defaults it). Applied as the last stage of the mix, identically live and offline. |
| `tracks` | `array<Track>` | Yes | Ordered list of tracks. May be empty. |
| `automation` | `array<AutomationLane>` | No (A1 2026-08-26, additive) | MASTER automation lanes (targets without `processorId` address root params, e.g. `"gain"` -> masterGain). Absent = none. The engine ignores this field until slice A2 (docs/AUTOMATION-DESIGN.md). |

### Track

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID v4. Immutable after creation. |
| `name` | `string` | Yes | Display name. Mutable. |
| `gain` | `float` | Yes | Linear gain multiplier. Range: 0.0 to 2.0. Default: 1.0. |
| `clips` | `array<Clip>` | Yes | Clips on this track, ordered by `startSample`. |
| `chain` | `array<Processor>` | Yes | Processing chain, applied in order. |
| `automation` | `array<AutomationLane>` | No (A1 2026-08-26, additive) | This track's automation lanes. Absent = none. The engine ignores this field until slice A2. |

### Clip

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID v4. Immutable after creation. |
| `name` | `string` | No | 2026-08-26, additive. Display name (right-click rename). Absent = the UI derives a name from the id (`clipDisplayName`, web/src/document/schema.ts). The engine ignores it. |
| `assetHash` | `string` | Yes | SHA-256 (64 hex chars) of the source file CONTENTS - real since 2.3a (2026-08-22, FIPS-vector tested). The hash is the asset's NAME KEY: assets resolve as `<assetHash>.wav` and existing documents keep their historical keys (16-char FNV names from before the swap stay valid as names; new documents always produce SHA-256). |
| `startSample` | `int64` | Yes | Position on timeline where clip begins. |
| `lengthSamples` | `int64` | Yes | Duration of the clip in samples. |
| `offsetSamples` | `int64` | Yes | Offset into the source asset. |
| `fadeInSamples` | `int64` | No | V1.6, additive. Explicit fade-in length. 0 or absent = the engine's implicit 4 ms anti-click ramp (sample_rate/250, clamped to half the clip - see docs/DECISIONS.md 2026-08-23). |
| `fadeOutSamples` | `int64` | No | V1.6, additive. Same contract as `fadeInSamples`, at the tail. |

### Processor

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID v4. Immutable after creation. |
| `type` | `string` | Yes | Processor type identifier. |
| `uid` | `string` | vst3 only | 32-hex VST3 class id. The document NEVER carries module paths - uid -> module resolution is host-side (`--vst3-module`). |
| `bypass` | `bool` | Yes (default false) | 2.4d: bypass is DOCUMENT state, driven from the tab. Live vst3: dry time-aligned (latency kept, pipeline warm). Offline / zero-latency nodes: identity. |
| `params` | `list<{key, value}>` | Yes | Parameter pairs as a LIST of `{key: string, value: float}` maps (list-of-pairs, not a map: iterable by index across every consumer). |

### AutomationLane

A1 (2026-08-26, additive - docs/AUTOMATION-DESIGN.md section 1). An
envelope: a time -> value curve attached to one parameter. Lives on a
track (`Track.automation`) or on the master (root `automation`). The
engine IGNORES these fields until slice A2; the web tier writes and
converges them today.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | `lane-` + 8 base36 chars. Immutable after creation. |
| `target.processorId` | `string` | No | Chain node the lane drives. ABSENT (key omitted, never null) = a TRACK param (gain/pan) - or a root param when the lane lives on the master list. |
| `target.param` | `string` | Yes | `"gain"` \| `"pan"` \| a native param key (e.g. `"drive"`) \| a VST3 param id as a decimal string (e.g. `"0"`). |
| `points` | `array<{t, v}>` | Yes | `t`: `int64` timeline samples, >= 0 (invariant 1). `v`: `float` NORMALIZED 0.0-1.0 - the consumer maps to units, the document never carries any. SORTED by `t` at write time (readers assume it). Linear interpolation between points, held flat outside the extremes; a per-point `shape` field will arrive later, additively. |
| `enabled` | `bool` | Yes | `false` = lane bypassed, the manual state takes over. An enabled lane WINS over the manual value (design section 2). |

## Processor Types

| Type | Parameters | Description |
|------|------------|-------------|
| `builtin.gain` | key `"gain"`: float (0.0-2.0) | Simple gain stage. |
| `vst3` (c-2, 2026-08-22) | keys are VST3 param ids as DECIMAL STRINGS (e.g. `"0"`), values normalized 0.0-1.0 | Out-of-process VST3 plugin (ADR-017). An engine that cannot resolve the uid SIGNALS and skips the node (live) or FAILS the render (offline) - never a silent different sound. |

## Invariants

1. **All temporal positions are `int64` sample counts.** Never seconds, never floats. This is non-negotiable.

2. **Binary blobs never enter the document.** Only their SHA-256 hash. Assets are stored separately.

3. **`schemaVersion` exists from v1.** Migration code exists from v1, even if empty.

4. **IDs are immutable.** Once assigned, a track/clip/processor ID never changes.

5. **Gain is linear, not dB.** UI may display dB, but the document stores linear multipliers.

## Migration

### From v0 (nonexistent) to v1

No migration needed. v1 is the initial version.

```typescript
function migrate(doc: any): ProjectDocument {
  const version = doc.schemaVersion ?? 0;

  if (version === 0) {
    // No v0 documents exist. This branch is never taken.
    // Placeholder for the migration pattern.
  }

  if (version > 1) {
    throw new Error(`Unknown schema version: ${version}`);
  }

  return doc as ProjectDocument;
}
```

## Example Document

```json
{
  "schemaVersion": 1,
  "sampleRate": 48000,
  "tracks": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Drums",
      "gain": 1.0,
      "clips": [
        {
          "id": "550e8400-e29b-41d4-a716-446655440010",
          "assetHash": "a948904f2f0f479b8f8564cbf12dac6b3f1a8c8c5d4e3f2a1b0c9d8e7f6a5b4c",
          "startSample": 0,
          "lengthSamples": 48000,
          "offsetSamples": 0
        }
      ],
      "chain": []
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "name": "Bass",
      "gain": 0.8,
      "clips": [],
      "chain": [
        {
          "id": "550e8400-e29b-41d4-a716-446655440020",
          "type": "builtin.gain",
          "params": [
            { "key": "gain", "value": 1.2 }
          ]
        },
        {
          "id": "550e8400-e29b-41d4-a716-446655440021",
          "type": "vst3",
          "uid": "84E8DE5F92554F5396FAE4133C935A18",
          "bypass": false,
          "params": [
            { "key": "0", "value": 0.5 }
          ]
        }
      ]
    }
  ]
}
```
