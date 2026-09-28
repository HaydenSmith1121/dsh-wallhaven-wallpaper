/**
 * Where the installed DSH lives, and how to read a file out of it.
 *
 *   import { resolveDshRoot, readDshFile, frontendAsset, playwrightEntry } from './harness-paths.mjs';
 *
 * The verification scripts have to reach into a *user's* DSH installation to
 * read the real theme tokens, the real shell CSS and the real React build. Two
 * things about that turned out to be version-dependent enough to be worth one
 * shared module:
 *
 *   · **Where the files are.** An Electron install ships its packages inside a
 *     single `resources/app.asar` archive; a CLI or unpacked install ships them
 *     as ordinary `resources/app/node_modules/…` directories. Both are current,
 *     and a hard-coded root is wrong on whichever one the author does not have —
 *     which is how this script came to point at a `DSH Desktop Beta` directory
 *     that no longer exists.
 *   · **What the files are called.** Vite content-hashes the web frontend's CSS
 *     (`index-J8NrHpw_.css`). The hash changes whenever the frontend changes, so
 *     a pinned filename is a test that breaks on an upgrade instead of reporting
 *     one. Assets are matched by pattern here.
 *
 * Nothing in this module throws on a missing install: every resolver returns
 * `null`, and the caller prints which of its inputs it could not find. A
 * verification script that cannot run should say what to install, not fail with
 * an `ENOENT` from four frames down.
 *
 * Overrides, all optional, all for pointing the scripts at an unusual install:
 *   DSH_APP_ROOT      the app root (the directory holding `node_modules/`, or
 *                     the `app.asar` itself)
 *   DSH_PLAYWRIGHT    an explicit `playwright-core` entry file
 *   DSH_REACT_ROOT    a directory holding `react/umd` and `react-dom/umd`
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/* ── reading out of an asar, or out of a directory ────────────────────────── */

/** Cached archive readers, keyed by asar path: parsing the header is not free. */
const ARCHIVES = new Map();

/**
 * Open an asar archive and index its header.
 *
 * Electron's asar is a pickle-prefixed JSON header followed by the concatenated
 * file payloads. The layout is stable and small enough to read directly, which
 * is what keeps this script dependency-free.
 *
 * @param archivePath - path to the `.asar` file.
 * @returns `{ buffer, header, dataOffset }`.
 */
function openArchive(archivePath) {
  const cached = ARCHIVES.get(archivePath);
  if (cached !== undefined) return cached;
  const buffer = readFileSync(archivePath);
  const jsonLength = buffer.readUInt32LE(12);
  const header = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString('utf8'));
  // The payload starts after the 8-byte pickle prefix plus the 4-byte-aligned
  // header size — not after the JSON, which is padded to an alignment boundary.
  const dataOffset = 8 + buffer.readUInt32LE(4);
  const opened = { buffer, header, dataOffset };
  ARCHIVES.set(archivePath, opened);
  return opened;
}

/**
 * Split a path into the archive root and the entry path inside it.
 *
 * Handles both `<x>.asar` and `<x>.asar/<entry>` spellings, because that is how
 * the two are written in the wild: the second is what a user copies out of an
 * Electron stack trace.
 *
 * @param path - any path.
 * @returns `{ archive, entry }`, or `null` when the path is not inside an asar.
 */
function splitAsar(path) {
  const marker = '.asar';
  const at = path.indexOf(marker);
  if (at < 0) return null;
  const after = path.slice(at + marker.length);
  if (after !== '' && !after.startsWith('\\') && !after.startsWith('/')) return null;
  return {
    archive: path.slice(0, at + marker.length),
    entry: after.replace(/^[\\/]+/u, '').split('\\').join('/'),
  };
}

/**
 * Read a file that may be an ordinary path or a path inside an asar.
 *
 * @param path - the file to read.
 * @returns its contents as a string.
 * @throws when the file is absent, with the path the caller asked for.
 */
export function readDshFile(path) {
  const inside = splitAsar(path);
  if (inside === null) return readFileSync(path, 'utf8');
  const { buffer, header, dataOffset } = openArchive(inside.archive);
  if (inside.entry === '') throw new Error(`${path} names an archive, not a file in one`);
  let node = header;
  for (const segment of inside.entry.split('/')) {
    node = node?.files?.[segment];
    if (node === undefined) throw new Error(`asar entry not found: ${inside.entry} in ${inside.archive}`);
  }
  if (node.files !== undefined) throw new Error(`asar entry is a directory: ${inside.entry}`);
  const from = dataOffset + Number(node.offset);
  return buffer.subarray(from, from + node.size).toString('utf8');
}

/**
 * Whether a path exists, inside an asar or outside one.
 *
 * @param path - the path to test.
 * @returns whether it names a regular file or a directory.
 */
export function dshPathExists(path) {
  const inside = splitAsar(path);
  if (inside === null) return existsSync(path);
  try {
    const { header } = openArchive(inside.archive);
    if (inside.entry === '') return true;
    let node = header;
    for (const segment of inside.entry.split('/')) {
      node = node?.files?.[segment];
      if (node === undefined) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * List a directory that may be inside an asar.
 *
 * @param path - the directory.
 * @returns the entry names, or `[]` when the directory is absent.
 */
export function listDshDir(path) {
  const inside = splitAsar(path);
  try {
    if (inside === null) return readdirSync(path);
    const { header } = openArchive(inside.archive);
    let node = header;
    if (inside.entry !== '') {
      for (const segment of inside.entry.split('/')) {
        node = node?.files?.[segment];
        if (node === undefined) return [];
      }
    }
    return Object.keys(node.files ?? {});
  } catch {
    return [];
  }
}

/* ── finding the install ──────────────────────────────────────────────────── */

/**
 * Roots worth trying when `DSH_APP_ROOT` is not set, most specific first.
 *
 * The standard install locations are tried first because they cost one `stat`
 * each. They are not enough on their own: DSH is an Electron app, so it can be
 * unpacked anywhere — this repository's own author has it under `D:\install\`
 * — and nothing on disk records where. So a bounded sweep of fixed drives
 * follows: a handful of container directories crossed with a handful of product
 * directory names. Every candidate is a single `stat` against a path that
 * usually does not exist, and the sweep stops at the first usable root, so the
 * cost is a few hundred failed `stat` calls in the worst case.
 *
 * @returns candidate app roots.
 */
function candidateRoots() {
  const roots = [];
  const push = (value) => {
    if (typeof value === 'string' && value !== '' && !roots.includes(value)) roots.push(value);
  };
  const pushInstall = (base, product) => {
    push(join(base, product, 'resources', 'app.asar'));
    push(join(base, product, 'resources', 'app'));
  };
  push(process.env['DSH_APP_ROOT']);

  const home = homedir();
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  const appData = process.env['APPDATA'] ?? '';

  // The product's directory name has changed at least once, so both spellings
  // are listed rather than guessed at.
  const PRODUCTS = ['DeepSeek Harness', 'Harness', 'DSH Desktop Beta', 'DSH Desktop', 'deepseek-harness'];

  // Electron install locations, then a bounded sweep of the fixed drives.
  const containers = [
    '',
    'install',
    'Install',
    'apps',
    'Applications',
    'opt',
    'Program Files',
    'Program Files (x86)',
  ];
  const bases = [localAppData, process.env['ProgramFiles'], process.env['ProgramFiles(x86)']];
  for (const base of bases) {
    if (base === '') continue;
    for (const product of PRODUCTS) pushInstall(base, product);
  }
  for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${drive}:\\`;
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue; // No such drive.
    }
    for (const container of containers) {
      for (const product of PRODUCTS) pushInstall(container === '' ? root : join(root, container), product);
    }
  }

  // macOS and Linux installs.
  push('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar');
  push('/opt/DeepSeek Harness/resources/app.asar');
  push('/opt/harness/resources/app.asar');
  push('/usr/lib/deepseek-harness/resources/app.asar');

  // A profile's own dependency tree, which holds the same @deepseek-ai packages
  // as the app root once `dsh plugin install` has run.
  for (const profile of ['desktop', 'web']) {
    push(join(home, '.dsh', 'profiles', profile));
  }
  push(join(appData, 'npm', 'node_modules'));
  return roots;
}

/**
 * Where the `@deepseek-ai` packages sit under an app root, or `null`.
 *
 * An Electron app root does not put its dependencies at a fixed depth. The
 * packaged desktop build ships them one level down, under `dsh/node_modules`,
 * because that level is the bundled runtime's own package project; an unpacked
 * or CLI install puts them directly at `node_modules`. Both are tried rather
 * than one being assumed, which is what makes this module work against the
 * install the repository's author actually has as well as a stock one.
 *
 * @param root - a candidate app root.
 * @returns the directory holding the `@deepseek-ai` scope, or `null`.
 */
function deepseekDir(root) {
  if (typeof root !== 'string' || root === '') return null;
  let fallback = null;
  for (const base of ['node_modules', join('dsh', 'node_modules')]) {
    const candidate = join(root, base, '@deepseek-ai');
    if (!dshPathExists(candidate)) continue;
    // An app root can carry more than one scope, and the packaged desktop build
    // does: a partial `@deepseek-ai` beside the runtime's own complete tree. The
    // one holding the packages the verification reads is the one meant here, so
    // it beats a candidate that merely exists.
    if (dshPathExists(join(candidate, 'dsh-client-ui-theme'))) return candidate;
    fallback ??= candidate;
  }
  return fallback;
}

/**
 * A root is usable when the two packages the verification needs both resolve.
 *
 * @param root - a candidate app root.
 * @returns whether it holds the theme and the web frontend.
 */
function isUsableRoot(root) {
  const scope = deepseekDir(root);
  if (scope === null) return false;
  return dshPathExists(join(scope, 'dsh-client-ui-theme', 'lib', 'client.js'))
    && dshPathExists(join(scope, 'dsh-web-frontend', 'dist', 'assets'));
}

/**
 * The first usable DSH root, or `null`.
 *
 * @returns the root path.
 */
export function resolveDshRoot() {
  for (const root of candidateRoots()) {
    try {
      if (isUsableRoot(root)) return root;
    } catch {
      // An unreadable candidate is simply not the one; the caller reports the
      // absence, not this candidate's error.
    }
  }
  return null;
}

/* ── the pieces the scripts need ──────────────────────────────────────────── */

/**
 * Locate a Vite-hashed asset by prefix and extension.
 *
 * The hash is deliberately not part of the pattern: pinning it is how this
 * script came to fail on a DSH upgrade rather than report one.
 *
 * @param root - the resolved DSH root.
 * @param prefix - the asset's leading name (`index`, `vendor`).
 * @param extension - the extension including the dot.
 * @returns the absolute path, or `null`.
 */
export function frontendAsset(root, prefix, extension) {
  const scope = deepseekDir(root);
  if (scope === null) return null;
  const assets = join(scope, 'dsh-web-frontend', 'dist', 'assets');
  const names = listDshDir(assets)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(extension))
    .sort();
  // More than one hash can coexist in a half-upgraded tree; the lexicographically
  // last is the newest build, and any of them is the real stylesheet.
  const chosen = names[names.length - 1];
  return chosen === undefined ? null : join(assets, chosen);
}

/**
 * The theme bundle that carries the `--dsw-*` token rules.
 *
 * @param root - the resolved DSH root.
 * @returns the path, or `null`.
 */
export function themeBundle(root) {
  const scope = deepseekDir(root);
  if (scope === null) return null;
  const path = join(scope, 'dsh-client-ui-theme', 'lib', 'client.js');
  return dshPathExists(path) ? path : null;
}

/**
 * A directory holding React 18 UMD builds.
 *
 * DSH's own `node_modules` does not necessarily carry the UMD builds — the
 * shell consumes React as a bundled module — so the DSH root is a candidate
 * among others rather than the answer.
 *
 * @param root - the resolved DSH root, or `null`.
 * @returns the directory, or `null`.
 */
export function resolveReactRoot(root) {
  const candidates = [];
  const push = (value) => {
    if (typeof value === 'string' && value !== '' && !candidates.includes(value)) candidates.push(value);
  };
  push(process.env['DSH_REACT_ROOT']);
  if (root !== null) push(join(root, 'node_modules'));
  push(join(process.cwd(), 'node_modules'));
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  push(join(process.env['APPDATA'] ?? '', 'npm', 'node_modules'));
  push(join(localAppData, 'npm', 'node_modules'));

  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, 'react', 'umd', 'react.development.js'))
        && existsSync(join(candidate, 'react-dom', 'umd', 'react-dom.development.js'))) {
        return candidate;
      }
    } catch {
      // Not this one.
    }
  }
  return null;
}

/**
 * The `playwright-core` entry file to import.
 *
 * Resolved rather than hard-coded: the previous version of this script named
 * one absolute path under one user's roaming profile, which is not a path any
 * other checkout has. A bare specifier is tried first so a normal
 * `npm install playwright-core` works, then the global npm roots, then
 * `DSH_PLAYWRIGHT` as the explicit override.
 *
 * @returns an absolute path or a bare specifier, or `null`.
 */
export function playwrightEntry() {
  const override = process.env['DSH_PLAYWRIGHT'];
  if (typeof override === 'string' && override !== '') return override;

  const require = createRequire(import.meta.url);
  for (const specifier of ['playwright-core', 'playwright']) {
    try {
      return require.resolve(specifier);
    } catch {
      // Not installed alongside this repository; try the global roots below.
    }
  }

  const roots = [
    join(process.env['APPDATA'] ?? '', 'npm', 'node_modules'),
    join(process.env['LOCALAPPDATA'] ?? '', 'npm', 'node_modules'),
    '/usr/lib/node_modules',
    '/usr/local/lib/node_modules',
  ];
  for (const base of roots) {
    for (const relative of [
      join('playwright-core', 'index.mjs'),
      join('playwright', 'index.mjs'),
      join('playwright', 'node_modules', 'playwright-core', 'index.mjs'),
      // `npm i -g @playwright/cli` is the current way to get the CLI, and it
      // nests the library rather than hoisting it. This is the layout the
      // author's machine actually has.
      join('@playwright', 'cli', 'node_modules', 'playwright-core', 'index.mjs'),
      join('@playwright', 'cli', 'node_modules', 'playwright', 'index.mjs'),
      join('@playwright', 'test', 'node_modules', 'playwright-core', 'index.mjs'),
      // agent-browser vendors its own copy, which is how the original author
      // reached one; kept as a candidate rather than as *the* path.
      join('agent-browser', 'node_modules', 'playwright-core', 'index.mjs'),
    ]) {
      const candidate = join(base, relative);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Not this one.
      }
    }
  }
  return null;
}

/**
 * Import `playwright-core`, or explain every way to supply it.
 *
 * @returns the module namespace.
 */
export async function importPlaywright() {
  const entry = playwrightEntry();
  if (entry === null) {
    throw new Error(
      '找不到 playwright-core：请 `npm i -D playwright-core`，'
      + '或设置 DSH_PLAYWRIGHT 指向它的 index.mjs。',
    );
  }
  return import(entry.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(entry) ? `file://${entry}` : entry);
}

/** Where a caller's own error message should point when a root is missing. */
export const DSH_ROOT_HELP = 'DSH_APP_ROOT=<DSH 的 app 目录或 resources/app.asar>';
