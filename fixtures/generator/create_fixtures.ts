// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Generate test fixtures for DAW engine.
 *
 * Creates:
 * - Test WAV files (sine waves)
 * - Project JSON files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const FIXTURES_DIR = path.join(__dirname, '..');

// Project schema types
interface ClipDef {
  id: string;
  assetHash: string;
  startSample: number;
  lengthSamples: number;
  offsetSamples: number;
}

interface ProcessorDef {
  id: string;
  type: string;
  params: Record<string, number>;
}

interface TrackDef {
  id: string;
  name: string;
  gain: number;
  clips: ClipDef[];
  chain: ProcessorDef[];
}

interface ProjectDef {
  schemaVersion: number;
  sampleRate: number;
  tracks: TrackDef[];
}

/**
 * Generate a WAV file containing a sine wave.
 */
function generateSineWav(
  filename: string,
  frequency: number,
  durationSec: number,
  sampleRate: number,
  channels: number
): string {
  const numSamples = Math.floor(sampleRate * durationSec);
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * channels * bytesPerSample;
  const fileSize = 36 + dataSize;

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // chunk size
  buffer.writeUInt16LE(1, offset); offset += 2; // PCM format
  buffer.writeUInt16LE(channels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, offset); offset += 4; // byte rate
  buffer.writeUInt16LE(channels * bytesPerSample, offset); offset += 2; // block align
  buffer.writeUInt16LE(16, offset); offset += 2; // bits per sample

  // data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // Generate sine wave samples
  const amplitude = 0.5; // 50% amplitude to avoid clipping
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude;
    const intSample = Math.floor(sample * 32767);

    for (let ch = 0; ch < channels; ch++) {
      buffer.writeInt16LE(intSample, offset);
      offset += 2;
    }
  }

  const filepath = path.join(FIXTURES_DIR, filename);
  fs.writeFileSync(filepath, buffer);

  // Compute hash
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  console.log(`Generated: ${filename} (hash: ${hash})`);

  return hash;
}

/**
 * Generate a simple hash for a WAV file.
 */
function hashFile(filename: string): string {
  const filepath = path.join(FIXTURES_DIR, filename);
  const data = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Generate a UUID.
 */
function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Main function.
 */
function main() {
  console.log('Generating fixtures...\n');

  // Generate test WAV files
  const monoHash = generateSineWav('sine-440hz-mono.wav', 440, 1.0, 48000, 1);
  const stereoHash = generateSineWav('sine-440hz-stereo.wav', 440, 1.0, 48000, 2);
  const longHash = generateSineWav('sine-220hz-stereo.wav', 220, 2.0, 48000, 2);

  // Copy WAV files with hash names (for asset lookup)
  fs.copyFileSync(
    path.join(FIXTURES_DIR, 'sine-440hz-mono.wav'),
    path.join(FIXTURES_DIR, `${monoHash}.wav`)
  );
  fs.copyFileSync(
    path.join(FIXTURES_DIR, 'sine-440hz-stereo.wav'),
    path.join(FIXTURES_DIR, `${stereoHash}.wav`)
  );
  fs.copyFileSync(
    path.join(FIXTURES_DIR, 'sine-220hz-stereo.wav'),
    path.join(FIXTURES_DIR, `${longHash}.wav`)
  );

  console.log('\nGenerating project files...\n');

  // Generate two-tracks.json
  const twoTracks: ProjectDef = {
    schemaVersion: 1,
    sampleRate: 48000,
    tracks: [
      {
        id: uuid(),
        name: 'Track 1 - Mono Sine',
        gain: 1.0,
        clips: [
          {
            id: uuid(),
            assetHash: monoHash,
            startSample: 0,
            lengthSamples: 48000, // 1 second
            offsetSamples: 0,
          },
        ],
        chain: [],
      },
      {
        id: uuid(),
        name: 'Track 2 - Stereo Sine',
        gain: 0.8,
        clips: [
          {
            id: uuid(),
            assetHash: stereoHash,
            startSample: 24000, // Start at 0.5s
            lengthSamples: 48000, // 1 second
            offsetSamples: 0,
          },
        ],
        chain: [
          {
            id: uuid(),
            type: 'builtin.gain',
            params: { gain: 0.5 },
          },
        ],
      },
    ],
  };

  fs.writeFileSync(
    path.join(FIXTURES_DIR, 'two-tracks.json'),
    JSON.stringify(twoTracks, null, 2)
  );
  console.log('Generated: two-tracks.json');

  // Generate simple-project.json (single track)
  const simpleProject: ProjectDef = {
    schemaVersion: 1,
    sampleRate: 48000,
    tracks: [
      {
        id: uuid(),
        name: 'Main',
        gain: 1.0,
        clips: [
          {
            id: uuid(),
            assetHash: stereoHash,
            startSample: 0,
            lengthSamples: 48000,
            offsetSamples: 0,
          },
        ],
        chain: [],
      },
    ],
  };

  fs.writeFileSync(
    path.join(FIXTURES_DIR, 'simple-project.json'),
    JSON.stringify(simpleProject, null, 2)
  );
  console.log('Generated: simple-project.json');

  // Generate gain-test.json (for testing gain changes)
  const gainTest: ProjectDef = {
    schemaVersion: 1,
    sampleRate: 48000,
    tracks: [
      {
        id: 'track-1',
        name: 'Gain Test Track',
        gain: 0.5, // 50% gain
        clips: [
          {
            id: 'clip-1',
            assetHash: stereoHash,
            startSample: 0,
            lengthSamples: 48000,
            offsetSamples: 0,
          },
        ],
        chain: [
          {
            id: 'gain-1',
            type: 'builtin.gain',
            params: { gain: 0.5 }, // Another 50% = 25% total
          },
        ],
      },
    ],
  };

  fs.writeFileSync(
    path.join(FIXTURES_DIR, 'gain-test.json'),
    JSON.stringify(gainTest, null, 2)
  );
  console.log('Generated: gain-test.json');

  console.log('\nFixtures generated successfully!');
  console.log('\nAsset hashes:');
  console.log(`  Mono 440Hz:   ${monoHash}`);
  console.log(`  Stereo 440Hz: ${stereoHash}`);
  console.log(`  Stereo 220Hz: ${longHash}`);
}

main();
