// SPDX-License-Identifier: GPL-3.0-or-later
// Cross-platform protobuf regeneration (replaces the POSIX-only npm
// one-liner - cp/mv/rm and a bare plugin path both broke on Windows,
// AUDIT-4 A4-20.5). Copies the engine proto (single source of truth),
// runs protoc with the platform-correct ts_proto plugin, flattens the
// output. Run whenever engine/src/protocol/messages.proto changes
// (CONTRACT rule: both stages regenerate in the same session).
import { copyFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const src = join(web, '..', 'engine', 'src', 'protocol', 'messages.proto');
const outDir = join(web, 'src', 'proto');

copyFileSync(src, join(outDir, 'messages.proto'));

const plugin = join(web, 'node_modules', '.bin',
  process.platform === 'win32' ? 'protoc-gen-ts_proto.cmd' : 'protoc-gen-ts_proto');
// Relative input path (cwd = web): protoc's proto_path defaults to the
// cwd and refuses absolute inputs outside an explicit -I.
const r = spawnSync('npx', [
  'protoc',
  `--plugin=protoc-gen-ts_proto=${plugin}`,
  '--ts_proto_out=src/proto',
  '--ts_proto_opt=esModuleInterop=true,outputEncodeMethods=true',
  'src/proto/messages.proto',
], { cwd: web, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) process.exit(r.status ?? 1);

// protoc mirrors the input path under out - flatten it
const nested = join(outDir, 'src', 'proto', 'messages.ts');
if (existsSync(nested)) {
  renameSync(nested, join(outDir, 'messages.ts'));
  rmSync(join(outDir, 'src'), { recursive: true, force: true });
}
console.log('proto regenerated:', join(outDir, 'messages.ts'));
