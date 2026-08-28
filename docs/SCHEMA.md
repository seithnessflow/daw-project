# Project Document Schema

**Version:** 2 (additive over 1 — a pure v1 document never changes)
**Format:** Automerge binary (`.am`)
**Source of truth:** This file. All three tiers (engine, server, web) conform to it.

## Schema v2 — musical time (ADDITIVE-DUAL, ratified 2026-08-27)

The document gains a MUSICAL domain (ticks, PPQ 960) BESIDE the
absolute domain (samples). Existing objects keep their exact samples
(warp-off, a la Live); new musical objects live in ticks and are
resolved to samples by the shared tempo kernel
(`web/src/document/tempo.ts` == `engine/src/graph/tempo.h`, an EXACT
integer mirror verified by `fixtures/tempo-vectors.json`).

New fields, ALL optional (presence of a `*Tick` field = the object is
musical; the two domains are EXCLUSIVE for a position — a clip carries
`startTick` OR `startSample`, never both):

| Field | Type | Description |
|-------|------|-------------|
| root `tempoMilliBpm` | `int64` | Project tempo in integer milli-BPM (120000 = 120 BPM), LWW, clamped 20000..999000. Absent = 120000. |
| root `tempoMap` | `array<{tick, milliBpm}>` | Piecewise-constant tempo breakpoints, sorted by tick. Absent = the register alone. Ramps will arrive later, additively. |
| root `timeSignature` | `array<{tick, num, den}>` | Positioned time-signature events (NOT automatable). Absent = 4/4 everywhere. |
| clip `startTick` | `int64` | Musical position. PRESENCE = musical clip. A musical AUDIO clip is positioned in ticks but its CONTENT stays in samples (moved by tempo, never stretched — it keeps `lengthSamples`). |
| clip `lengthTick` | `int64` | Musical length (musical MIDI clips). |
| note `startTick`/`lengthTick` | `int64` | Musical note positions, relative to the clip. The parent clip's domain governs. |
| lane `timeBase` | `"ticks"` | Point `t` values are ticks (musical lane). Absent = samples. |

The v1 -> v2 bump is LAZY (`ensureV2` at the first musical write);
`createEmptyDocument` STAYS v1 (the vendored common seed must remain
byte-identical across tiers). Durations are differences of positions:
adjacent musical clips resolve seamlessly by construction.

> **Status 2026-08-28.** Stems and plugin state SHIPPED (2026-08-23, fields
> on Processor below — engine-authored). PLACEMENT (each node declaring
> which peer hosts it, ADR-019 §2) was never designed: today a node whose
> uid does not resolve locally is substituted by its stem. Open decision,
> TODO.md §2.
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
| `automation` | `array<AutomationLane>` | No (A1 2026-08-26, additive) | MASTER automation lanes (targets without `processorId` address root params, e.g. `"gain"` -> masterGain). Absent = none. A2 (same day): the engine EVALUATES `gain` lanes here (enabled lane WINS over `masterGain`, mapping v*2). |

### Track

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID v4. Immutable after creation. |
| `name` | `string` | Yes | Display name. Mutable. |
| `gain` | `float` | Yes | Linear gain multiplier. Range: 0.0 to 2.0. Default: 1.0. |
| `clips` | `array<Clip>` | Yes | Clips on this track, ordered by `startSample`. |
| `chain` | `array<Processor>` | Yes | Processing chain, applied in order. |
| `order` | `float` | No (D1 2026-08-26, additive) | DISPLAY order (fractional indexing: dropping between neighbors writes their midpoint). The Automerge list keeps CREATION order - objects never move in the list, so concurrent edits keep their identity (docs/DND-DESIGN.md). Consumers sort via `orderedTracks` (web/src/document/schema.ts); absent = the list index. The engine ignores it (mixing is order-independent). |
| `automation` | `array<AutomationLane>` | No (A1 2026-08-26, additive) | This track's automation lanes. Absent = none. A2 (same day): the engine EVALUATES track-param lanes (`processorId` absent, param `gain`/`pan`; enabled lane WINS over the manual value; mapping gain v*2, pan v*2-1; per-256-frame-block evaluation, engine/src/graph/automation.h mirrors web automationValueAt). Device-param lanes (`processorId` set) stay ignored until A4. |
| `kind` | `"audio"` \| `"midi"` | No (2026-08-27, additive) | Track TYPE - an EDITING contract enforced by UI gesture guards (no samples/WAV on a `midi` track; no MIDI clips or instruments on an `audio` track). ABSENT = legacy mixed track (accepts everything - every pre-existing project). The ENGINE ignores it (it already plays both clip kinds per track). Factory: `makeTrackDef` (web/src/document/schema.ts), created via the corner `+` button menu. |
| `pan` | `float` | No (F2 2026-08-25, additive) | -1 (left) .. 0 (center) .. +1 (right), applied POST-chain. Linear centre-neutral law (pan 0 == unchanged, deterministic hash preserved) - not equal-power (dated debt). Absent = 0. |

### Scenes (Session view, T7 2026-08-25, additive)

Root `scenes: array<{id, name}>` - one scene = one ROW of the clip
launcher. Absent = no Session view. A session slot is a Clip carrying
`sceneId` (see Clip); the engine ignores such clips on the timeline and
launches them on demand (quantized launch, engine truth in telemetry).
Performance state (which slot plays/is queued) is NEVER in the document.

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
| `notes` | `array<Note>` | No (v8 MIDI, additive) | PRESENT = MIDI clip (`assetHash` is then the empty string; `offsetSamples` unused). The clip's audio is the instrument at the head of the track chain. NOTE: implemented as a LIST without ids; SCHEMA-V2-DESIGN §4 asked for a MAP with stable ids (concurrent note insertions can diverge) - additive fix planned with the MIDI wave (TODO ordre grave 4). |
| `sceneId` | `string` | No (T7, additive) | PRESENT = this clip is a Session SLOT of scene `sceneId`, not a timeline clip. |
| `startSample` / `lengthSamples` | | | Since v2 (T3) both are OPTIONAL in the type: a MUSICAL clip carries `startTick` (and `lengthTick` for MIDI) instead. Every consumer reads geometry through `geometry.clipStartSamples` (web) / `resolveMusicalTime` (engine), never the raw field. |

### Note (inside `Clip.notes`)

| Field | Type | Description |
|---|---|---|
| `id` | `string` | No (2026-08-28, additive): `n-` + 8 base36, written at creation by `toggleNote`. The ADDRESS of a note for edits (`updateNote(id, patch)`: velocity, pitch, position, length - LWW per field, undo-journalized). Absent on historical notes (still addressable by pitch+start through `toggleNote`). The engine ignores it. |
| `pitch` | `int` | 0..127 |
| `velocity` | `int` | 0..127 (piano-roll writes 100; editable through `updateNote`) |
| `startSample` / `lengthSamples` | `int64` | Relative to the clip start (absolute clip). |
| `startTick` / `lengthTick` | `int64` | Relative to the clip start (musical clip). The parent clip's domain governs - never a mix. |

### Processor

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID v4. Immutable after creation. |
| `type` | `string` | Yes | Processor type identifier. |
| `uid` | `string` | vst3 only | 32-hex VST3 class id. The document NEVER carries module paths - uid -> module resolution is host-side (`--vst3-module`). |
| `bypass` | `bool` | Yes (default false) | 2.4d: bypass is DOCUMENT state, driven from the tab. Live vst3: dry time-aligned (latency kept, pipeline warm). Offline / zero-latency nodes: identity. |
| `params` | `list<{key, value}>` | Yes | Parameter pairs as a LIST of `{key: string, value: float}` maps (list-of-pairs, not a map: iterable by index across every consumer; the engine keeps DOCUMENT order - it feeds the stem key). |
| `name` | `string` | No (additive) | Display name written by the tab at add time (the device title bar). The engine ignores it. |
| `stateHash` | `string` | No (2.5-etat 2026-08-23, additive, ENGINE-authored) | SHA-256 of the plugin's opaque state blob in the store (`IComponent::getState`; controller state not yet serialized - TODO). Only the machine hosting the plugin writes it. |
| `stateVersion` | `int` | No (additive, ENGINE-authored) | LWW counter for `stateHash` (two hashes do not order themselves; no binary state merge). |
| `stemHash` | `string` | No (S7 2026-08-23, additive, ENGINE-authored) | SHA-256 of the rendered stem WAV (float32) in the store - the node's rendered truth for peers without the plugin. The stem covers the node AND its whole upstream chain (post-clips, pre-track-gain); a peer substitutes the chain by the stem of the LAST unresolvable vst3 node. |
| `stemKey` | `string` | No (additive, ENGINE-authored) | Input-cache freshness key (`stem-v2`: uid, module version tag, sample rate, state hash, ordered params, resolved clip geometry/fades/upstream gain). Stale = UI badge state, never a playback block. Never an assertion of bit-exact re-render (ADR-019 amendment). |
| `stemLatencySamples` | `int64` | No (additive, ENGINE-authored) | Declared PDC of the rendered chain: the stem player reads AHEAD by this amount. |

### AutomationLane

A1 (2026-08-26, additive - docs/AUTOMATION-DESIGN.md section 1). An
envelope: a time -> value curve attached to one parameter. Lives on a
track (`Track.automation`) or on the master (root `automation`). The
engine EVALUATES track/master gain-pan lanes since A2 (device-param
lanes wait for A4); the web tier writes and
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
| `builtin.utility` (4.1, 2026-08-25) | `gain`, `pan`, mono, phase (keys and units: `NATIVE_PARAM_SPECS`, web/src/ui/track.ts - the single UI source; engine mirror in graph/utility_node) | Gain / balance-law pan / mono sum / polarity. Smoothing starts on target (bit-exact). |
| `builtin.eq3` (4.2) | 3 bands (low/mid/high gains + freqs), see `NATIVE_PARAM_SPECS` | Biquads computed off-callback. |
| `builtin.comp` (4.2) | threshold, `ratio`, attack, release, makeup, see `NATIVE_PARAM_SPECS` | Detector + smoothed gain. Gain-reduction meter not yet published (TODO). |
| `builtin.drive` (4.3) | drive, mix, see `NATIVE_PARAM_SPECS` | 4x oversampled saturation, first real PDC client (16 samples declared). |
| `builtin.delay` (4.3) | time (ms, awaiting musical sync), `feedback`, mix, see `NATIVE_PARAM_SPECS` | Sample-exact impulse, decay = feedback. |
| `vst3` (c-2, 2026-08-22) | keys are VST3 param ids as DECIMAL STRINGS (e.g. `"0"`), values normalized 0.0-1.0 | Out-of-process VST3 plugin (ADR-017). An engine that cannot resolve the uid SIGNALS and plays the node's STEM if one exists (live), or FAILS the render (offline) - never a silent different sound. |

Param KEYS of the native nodes are declared once in `NATIVE_PARAM_SPECS`
(web) and read by name in the engine nodes - a manual twin (AUDIT-5 F);
this table names the types, the code names the keys.

## Invariants

1. **All temporal positions are `int64` — sample counts OR ticks (v2), never seconds, never floats.** The two integer domains are exclusive per position (a musical object carries ticks, an absolute one samples); resolution between them goes through the shared integer tempo kernel only. This is non-negotiable.

2. **Binary blobs never enter the document.** Only their SHA-256 hash. Assets are stored separately.

3. **`schemaVersion` exists from v1.** Migration code exists from v1, even if empty. (Known gap, AUDIT-4 A4-8: `migrateDocument`/`validateDocument` are not called at load time on either tier - a corrupt document loads silently. Tracked in TODO.)

4. **IDs are immutable.** Once assigned, a track/clip/processor ID never changes.

5. **Gain is linear, not dB.** UI may display dB, but the document stores linear multipliers.

## Migration

### v1 -> v2

Purely ADDITIVE: a v2 reader reads a v1 document as is; nothing to
rewrite. The bump is LAZY (`ensureV2` inside the change that performs
the first musical write); `createEmptyDocument` stays v1 so the vendored
common seed keeps its bytes. A reader refuses `schemaVersion > 2`
(`migrateDocument`, web/src/document/schema.ts).

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
