/**
 * Pack: `lib/` → a tarball the profile can install as a `file:` dependency.
 *
 *   node scripts/pack.mjs [--out <directory>]
 *
 * `npm pack` is not used on purpose. A package that installs straight from the
 * repository must not need a build step of its own, and the tarball is the same
 * artifact either way — so this writes the gzipped tar directly, with the
 * `package/` prefix npm's own tarballs carry, and no dependency on a package
 * manager being able to run in this environment.
 */

import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const outIndex = process.argv.indexOf('--out');
const OUT = outIndex >= 0 && process.argv[outIndex + 1] !== undefined
  ? process.argv[outIndex + 1]
  : join(REPO, 'dist');

const pkg = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'));
const stage = await mkdtemp(join(tmpdir(), 'dsh-wh-pack-'));
const packageDir = join(stage, 'package');
await mkdir(packageDir, { recursive: true });

for (const entry of pkg.files) {
  await cp(join(REPO, entry), join(packageDir, entry), { recursive: true });
}

// `files` lists what a consumer needs; the manifest itself always goes.
await cp(join(REPO, 'package.json'), join(packageDir, 'package.json'));

await mkdir(OUT, { recursive: true });
const tarball = join(OUT, `${pkg.name}-${pkg.version}.tgz`);
await rm(tarball, { force: true });

// `tar` rather than a Node archiver: it is present on every platform this
// plugin targets, and it produces a byte-stable, npm-compatible archive.
execFileSync('tar', ['-czf', tarball, '-C', stage, 'package'], { stdio: 'inherit' });

const bytes = await readFile(tarball);
console.log(`${tarball}`);
console.log(`  ${String(bytes.length)} bytes  sha256=${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}…`);

await rm(stage, { recursive: true, force: true });
