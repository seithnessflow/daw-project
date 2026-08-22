# Project Document Schema

**Version:** 1
**Format:** Automerge binary (`.am`)
**Source of truth:** This file. All three tiers (engine, server, web) conform to it.

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
          "assetHash": "string (SHA-256 hex)",
          "startSample": "int64",
          "lengthSamples": "int64",
          "offsetSamples": "int64"
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
| `tracks` | `array<Track>` | Yes | Ordered list of tracks. May be empty. |

### Track

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID v4. Immutable after creation. |
| `name` | `string` | Yes | Display name. Mutable. |
| `gain` | `float` | Yes | Linear gain multiplier. Range: 0.0 to 2.0. Default: 1.0. |
| `clips` | `array<Clip>` | Yes | Clips on this track, ordered by `startSample`. |
| `chain` | `array<Processor>` | Yes | Processing chain, applied in order. |

### Clip

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID v4. Immutable after creation. |
| `assetHash` | `string` | Yes | SHA-256 hex digest of the source audio file. |
| `startSample` | `int64` | Yes | Position on timeline where clip begins. |
| `lengthSamples` | `int64` | Yes | Duration of the clip in samples. |
| `offsetSamples` | `int64` | Yes | Offset into the source asset. |

### Processor

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID v4. Immutable after creation. |
| `type` | `string` | Yes | Processor type identifier. |
| `uid` | `string` | vst3 only | 32-hex VST3 class id. The document NEVER carries module paths - uid -> module resolution is host-side (`--vst3-module`). |
| `bypass` | `bool` | Yes (default false) | 2.4d: bypass is DOCUMENT state, driven from the tab. Live vst3: dry time-aligned (latency kept, pipeline warm). Offline / zero-latency nodes: identity. |
| `params` | `list<{key, value}>` | Yes | Parameter pairs as a LIST of `{key: string, value: float}` maps (list-of-pairs, not a map: iterable by index across every consumer). |

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
