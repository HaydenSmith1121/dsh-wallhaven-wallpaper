/*
 * Host-side version adaptation.
 *
 * Two jobs, both about being honest on a harness this plugin was not built
 * against:
 *
 *   1. work out which DSH is running, from whatever evidence the process
 *      actually offers — and say *where* the answer came from, because
 *      "0.1.7-rc.2" read out of a stale lockfile is worse than "unknown";
 *   2. expose that, plus the outcome of every host integration point, as one
 *      report the settings page can render.
 *
 * Nothing here gates behaviour on the version it finds. See `shared/compat.js`
 * for why.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyVersion, parseVersion, reasonOf } from '../shared/compat.js';

/** How many ancestor directories {@link walkUpForManifest} will inspect. */
const MAX_WALK_DEPTH = 12;

/** Where the CLI package's manifest sits, relative to a `node_modules` root. */
const MANIFEST_RELATIVE_PATHS = [
  join('node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  join('@deepseek-ai', 'dsh', 'package.json'),
];

/**
 * Read `version` out of a package manifest without trusting its contents.
 *
 * @param path - the manifest path.
 * @returns the version string, or `null`.
 */
function versionOfManifest(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const version = parsed?.version;
    return typeof version === 'string' && parseVersion(version) !== null ? version : null;
  } catch {
    return null;
  }
}

/**
 * Find `@deepseek-ai/dsh/package.json` at or above `start`.
 *
 * `start` may be a file or a directory: a path that is not a directory simply
 * fails every candidate check and the walk moves to its parent, which is what
 * makes `process.argv[1]` (a file) and `profileContext.dir` (a directory)
 * usable through the same function.
 *
 * @param start - where to begin.
 * @returns the manifest path, or `null`.
 */
function walkUpForManifest(start) {
  let directory = start;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    for (const relative of MANIFEST_RELATIVE_PATHS) {
      const candidate = join(directory, relative);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

/**
 * Every starting point worth trying, best first.
 *
 * `argv[1]` is the harness's own entry script under both `dsh web` and the
 * desktop host; `argv[2]` is the runtime directory the desktop host passes
 * explicitly. `import.meta.url` is this file, which lives inside the plugin and
 * is therefore the weakest hint — it is last for that reason.
 *
 * @returns candidate paths.
 */
function detectionRoots(ctx) {
  const roots = [];
  for (const arg of [process.argv[1], process.argv[2]]) {
    if (typeof arg === 'string' && arg !== '') roots.push(arg);
  }
  // `ctx.get` is the harness's own service lookup and is not contractually
  // total: a context that throws here must not turn "which version is this"
  // into an exception escaping `apply()`.
  let profile = null;
  try {
    profile = ctx?.get?.('profileContext') ?? null;
  } catch {
    profile = null;
  }
  if (typeof profile?.dir === 'string' && profile.dir !== '') roots.push(profile.dir);
  if (typeof profile?.installAnchor === 'string' && profile.installAnchor !== '') roots.push(profile.installAnchor);
  try {
    roots.push(fileURLToPath(import.meta.url));
  } catch {
    // `import.meta.url` is always a file URL under Node; this is belt and braces.
  }
  return roots;
}

/**
 * Resolve the DSH CLI manifest through the harness's own Loader.
 *
 * This is the canonical route — it is the same resolution the client-module
 * registry uses to find a package's manifest — but it reaches into
 * `ctx.loader.internal`, which is explicitly an internal contract. It is tried
 * first and abandoned silently, because on a harness that reshapes it the
 * filesystem probes below still answer.
 *
 * @param ctx - the host context.
 * @returns the manifest path, or `null`.
 */
function resolveViaLoader(ctx) {
  const internal = ctx?.loader?.internal;
  if (internal === undefined || internal === null) return null;
  if (typeof Reflect.get(internal, 'resolveSync') !== 'function') return null;
  const specifier = '@deepseek-ai/dsh/package.json';
  const baseUrl = typeof ctx?.loader?.baseUrl === 'string' ? ctx.loader.baseUrl : undefined;
  try {
    const resolved = internal.version === 'v2'
      ? internal.resolveSync(baseUrl, { specifier, attributes: {} })
      : internal.resolveSync(specifier, baseUrl, {});
    const url = resolved?.url;
    if (typeof url !== 'string' || !url.startsWith('file:')) return null;
    const path = fileURLToPath(url);
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the DSH CLI manifest from this module's own position.
 *
 * @returns the manifest path, or `null`.
 */
function resolveViaRequire() {
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve('@deepseek-ai/dsh/package.json');
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * Work out which DSH is running.
 *
 * @param ctx - the host context.
 * @returns `{ version, source }`; `version` is `''` when nothing was found and
 *   `source` always names the strategy that answered.
 */
export function detectDshVersion(ctx) {
  const viaLoader = resolveViaLoader(ctx);
  if (viaLoader !== null) {
    const version = versionOfManifest(viaLoader);
    if (version !== null) return { version, source: 'loader' };
  }

  const viaRequire = resolveViaRequire();
  if (viaRequire !== null) {
    const version = versionOfManifest(viaRequire);
    if (version !== null) return { version, source: 'require' };
  }

  for (const root of detectionRoots(ctx)) {
    const manifest = walkUpForManifest(root);
    if (manifest === null) continue;
    const version = versionOfManifest(manifest);
    if (version !== null) return { version, source: 'filesystem' };
  }

  return { version: '', source: 'unknown' };
}

/**
 * The environment facts the settings page shows in its compatibility section.
 *
 * Every field is best-effort: a harness that hides `profileContext`, or a
 * runtime that will not answer, produces `''` rather than an exception, because
 * this runs while the fiber is applying.
 *
 * @param ctx - the host context.
 * @returns the environment report.
 */
export function describeHostEnvironment(ctx) {
  const detected = detectDshVersion(ctx);

  let profile = '';
  let home = '';
  try {
    const profileContext = ctx?.get?.('profileContext');
    if (typeof profileContext?.name === 'string') profile = profileContext.name;
    if (typeof profileContext?.home === 'string') home = profileContext.home;
  } catch (error) {
    // A `get` that throws is a harness fact, not a plugin failure.
    profile = `（读取失败：${reasonOf(error)}）`;
  }

  return {
    dshVersion: detected.version,
    dshVersionStatus: classifyVersion(detected.version),
    dshVersionSource: detected.source,
    profile,
    home,
    node: typeof process.versions?.node === 'string' ? process.versions.node : '',
    platform: process.platform,
  };
}

/**
 * A capability report that is filled in as the plugin applies.
 *
 * The host half claims its route inside a Cordis effect, so the outcome is not
 * known when this object is created. Returning a mutable record — rather than a
 * frozen snapshot — is what lets `GET /compat` answer with the *current* state
 * of every integration point instead of a guess made at construction time.
 *
 * @param environment - the result of {@link describeHostEnvironment}.
 * @returns `{ environment, routes, setRoutes }`.
 */
export function createHostCompat(environment) {
  let routes = { ok: false, mode: 'pending', error: '尚未注册' };
  return {
    environment,
    /** The current route-registration outcome. */
    get routes() {
      return routes;
    },
    /** Record the outcome of the one route registration this plugin makes. */
    setRoutes(next) {
      routes = next;
    },
  };
}
