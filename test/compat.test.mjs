/*
 * Version adaptation.
 *
 * This suite exists because the code it covers is *only* exercised on a harness
 * that is not the one this plugin was written against — the happy path is
 * covered by every other test in this directory, and by `verify:client` against
 * a real browser. What is tested here is the other half: that a harness which
 * answers differently produces a recorded, printable failure instead of an
 * exception escaping `apply()`.
 *
 * The three that matter most:
 *   · a `locale` service with only the per-locale `register` overload still gets
 *     the whole dictionary set, and a throw halfway through is rolled back;
 *   · a `slots` service that throws on one seat still gets the other one;
 *   · `readableForeground` refuses a text colour the theme offers when it would
 *     be unreadable — the white-on-white trap on DSH's dark palette.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  COMPAT_STATUSES,
  VERIFIED_DSH_VERSIONS,
  classifyVersion,
  compatEntry,
  createTranslator,
  isEnforcedDshPeer,
  parseVersion,
  reasonOf,
  registerLocaleDictionary,
  registerPrefixRoute,
  registerSlotSurface,
  summarizeCompat,
  versionAtLeast,
} from '../src/shared/compat.js';
import { contrastRatio, readableForeground, relativeLuminance } from '../src/shared/constants.js';
import { createHostCompat, describeHostEnvironment, detectDshVersion } from '../src/host/compat.js';

/* ── version strings ──────────────────────────────────────────────────────── */

test('parseVersion accepts the shapes DSH actually ships and rejects guesses', () => {
  assert.deepEqual(parseVersion('0.1.7-rc.2'), {
    major: 0, minor: 1, patch: 7, prerelease: 'rc.2', raw: '0.1.7-rc.2',
  });
  assert.equal(parseVersion('0.1.6-alpha.1')?.prerelease, 'alpha.1');
  assert.equal(parseVersion('0.1.7')?.prerelease, '');
  assert.equal(parseVersion('v2.3.4')?.major, 2);
  // A bare `0.1` is a real DSH version string shape; `garbage` is not, and a
  // wrong number displayed to the user is worse than no number.
  assert.equal(parseVersion('0.1')?.minor, 1);
  assert.equal(parseVersion('garbage'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
  assert.equal(parseVersion(7), null);
});

test('versionAtLeast orders prereleases below their release', () => {
  assert.equal(versionAtLeast('0.1.7-rc.2', '0.1.6-alpha.1'), true);
  assert.equal(versionAtLeast('0.1.6-alpha.1', '0.1.7-rc.2'), false);
  assert.equal(versionAtLeast('0.1.7', '0.1.7-rc.2'), true);
  assert.equal(versionAtLeast('0.1.7-rc.2', '0.1.7'), false);
  assert.equal(versionAtLeast('0.1.7', '0.1.7'), true);
  // An unparsable side can never satisfy a floor.
  assert.equal(versionAtLeast('unknown', '0.1.0'), false);
  assert.equal(versionAtLeast('1.0.0', 'unknown'), false);
});

test('classifyVersion labels a verified build and never gates on the number', () => {
  assert.equal(classifyVersion('0.1.7-rc.2'), 'verified');
  assert.equal(classifyVersion('0.1.6-alpha.1'), 'verified');
  assert.equal(classifyVersion('0.2.0-rc.1'), 'verified');
  assert.equal(classifyVersion('9.9.9-nightly.7'), 'untested');
  assert.equal(classifyVersion(''), 'unknown');
  assert.equal(classifyVersion(null), 'unknown');
  // The list is advisory, so an empty override marks everything untested rather
  // than crashing — that is what makes it safe to edit.
  assert.equal(classifyVersion('0.1.7-rc.2', []), 'untested');
  assert.ok(VERIFIED_DSH_VERSIONS.length > 0);
});

test('a prerelease sorts below its own release, so 0.2.0-rc.1 < 0.2.0', () => {
  // Worth pinning: every DSH runtime this plugin has been verified on is a
  // prerelease, so the comparison has to treat `rc.1` as *older* than `0.2.0`
  // rather than as an unrelated string.
  assert.equal(versionAtLeast('0.2.0-rc.1', '0.1.7-rc.2'), true);
  assert.equal(versionAtLeast('0.2.0-rc.1', '0.2.0'), false);
  assert.equal(versionAtLeast('0.2.0', '0.2.0-rc.1'), true);
});

/* ── the runtime's plugin-compatibility gate ──────────────────────────────── */

/*
 * DSH 0.2.0-rc.1 added `evaluatePluginCompatibility()`: it tests every
 * `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` key in a package's
 * `peerDependencies` against the running runtime and, on a mismatch, does not
 * warn — it skips the whole **bundle** at startup and rewrites the **loader
 * row** to `disabled: true`, unless the profile carries an exact
 * `name@version` exemption.
 *
 * The only reason this plugin loads on a runtime its author has never seen is
 * that it declares no peer in that scope. That makes the property load-bearing
 * rather than stylistic, so it is asserted here: a future edit that adds a
 * `@deepseek-ai/dsh` peer would not fail any other gate in this repository —
 * it would fail silently, as a plugin that vanishes from a profile.
 */

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('isEnforcedDshPeer mirrors the runtime, including the bare scope and near misses', () => {
  assert.equal(isEnforcedDshPeer('@deepseek-ai/dsh'), true);
  assert.equal(isEnforcedDshPeer('@deepseek-ai/dsh-client-ui-slots'), true);
  // Out of scope: the runtime ignores these, so a range here is harmless.
  assert.equal(isEnforcedDshPeer('@deepseek-ai/cordis'), false);
  assert.equal(isEnforcedDshPeer('react'), false);
  // Near misses that a looser prefix test would wrongly flag.
  assert.equal(isEnforcedDshPeer('@deepseek-ai/dshx'), false);
  assert.equal(isEnforcedDshPeer('dsh'), false);
  assert.equal(isEnforcedDshPeer('@other/dsh-thing'), false);
});

test('the manifest declares no peer the 0.2.0 compatibility gate could refuse', () => {
  const peers = Object.keys(manifest.peerDependencies ?? {});
  assert.deepEqual(peers.filter(isEnforcedDshPeer), []);
  // And the peers it does declare stay out of that scope, because a range there
  // would be exactly the version assertion the probe layer exists to avoid.
  assert.deepEqual([...peers].sort(), ['@deepseek-ai/cordis', 'react']);
});

test('the manifest keeps every field the client-half discovery path reads', () => {
  assert.equal(manifest.dsh?.manifestVersion, 1);
  assert.equal(manifest.dsh?.client?.platform, 'web');
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(manifest.exports?.['./client'], './lib/client.js');
  // A declared path that does not exist is a client half that never arrives.
  assert.ok(existsSync(new URL('../lib/client.js', import.meta.url)));
  assert.ok(existsSync(new URL('../cordis.patch.yml', import.meta.url)));
});

/* ── the report ───────────────────────────────────────────────────────────── */

test('compatEntry coerces an unknown status rather than emitting a bad colour key', () => {
  assert.equal(compatEntry('a', 'A', 'ok', 'd').status, 'ok');
  assert.equal(compatEntry('a', 'A', 'nonsense', 'd').status, 'degraded');
  assert.equal(compatEntry('a', 'A', 'ok', undefined).detail, '');
  assert.deepEqual(COMPAT_STATUSES, ['ok', 'degraded', 'missing']);
});

test('summarizeCompat calls a missing optional seat partial, not unsupported', () => {
  const full = summarizeCompat([
    compatEntry('a', 'A', 'ok', ''),
    compatEntry('b', 'B', 'ok', ''),
  ]);
  assert.equal(full.verdict, 'full');
  assert.equal(full.ok, 2);

  // The sidebar seat is additive: losing it is a smaller feature set.
  const partial = summarizeCompat([
    compatEntry('a', 'A', 'ok', ''),
    compatEntry('b', 'B', 'degraded', ''),
  ]);
  assert.equal(partial.verdict, 'partial');
  assert.equal(partial.degraded, 1);

  const unsupported = summarizeCompat([compatEntry('a', 'A', 'missing', '')]);
  assert.equal(unsupported.verdict, 'unsupported');
  assert.equal(unsupported.failed, 1);

  assert.equal(summarizeCompat([]).verdict, 'full');
  assert.equal(summarizeCompat(undefined).total, 0);
});

test('reasonOf prints something for every shape a throw can take', () => {
  assert.equal(reasonOf(new Error('boom')), 'boom');
  assert.equal(reasonOf('plain string'), 'plain string');
  assert.equal(reasonOf(null), '未知错误');
  assert.equal(reasonOf({ code: 7 }), '[object Object]');
});

/* ── locale ───────────────────────────────────────────────────────────────── */

test('registerLocaleDictionary prefers the bundled overload', () => {
  const calls = [];
  const locale = {
    register: (...args) => {
      calls.push(args);
      return () => calls.push(['dispose']);
    },
  };
  const result = registerLocaleDictionary(locale, 'ns', { zh: { a: '甲' }, en: { a: 'A' } });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'bundled');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  result.dispose();
  assert.deepEqual(calls.at(-1), ['dispose']);
});

test('registerLocaleDictionary falls back to the per-locale overload', () => {
  const calls = [];
  const locale = {
    register: (ns, a, b) => {
      calls.push([ns, a, b]);
      if (typeof a !== 'string') throw new Error('register(ns, locale, dict) expected');
      return () => undefined;
    },
  };
  const result = registerLocaleDictionary(locale, 'ns', { zh: { a: '甲' }, en: { a: 'A' } });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'per-locale');
  // One rejected bundled attempt, then one call per locale.
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], ['ns', 'zh', { a: '甲' }]);
  assert.deepEqual(calls[2], ['ns', 'en', { a: 'A' }]);
});

test('registerLocaleDictionary rolls back a half-finished per-locale registration', () => {
  const disposed = [];
  const locale = {
    register: (ns, a) => {
      if (typeof a !== 'string') throw new Error('bundled unsupported');
      if (a === 'en') throw new Error('no room for en');
      return () => disposed.push(a);
    },
  };
  const result = registerLocaleDictionary(locale, 'ns', { zh: { a: '甲' }, en: { a: 'A' } });
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'none');
  // `zh` was registered before `en` threw, so it must have been released.
  assert.deepEqual(disposed, ['zh']);
  // Both reasons are reported: the first explains why the fast path was skipped.
  assert.match(result.error, /bundled unsupported/);
  assert.match(result.error, /no room for en/);
  // The caller registers the disposer unconditionally, so it must exist.
  assert.equal(typeof result.dispose, 'function');
});

test('registerLocaleDictionary refuses a locale service that is not one', () => {
  for (const value of [null, undefined, {}, { register: 'not a function' }]) {
    const result = registerLocaleDictionary(value, 'ns', { en: {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /register/);
  }
});

test('createTranslator prefers the harness binding, and falls back when it is hollow', () => {
  const dictionaries = { zh: { title: '壁纸' }, en: { title: 'Wallpaper' } };

  const bound = createTranslator({ bind: () => (key) => `bound:${key}` }, 'ns', dictionaries, 'zh');
  assert.equal(bound.mode, 'bound');
  assert.equal(bound.t('title'), 'bound:title');

  // A `bind` that exists but answers nothing is not a translator: the page would
  // render blank keys, so the local dictionary has to win.
  const hollow = createTranslator({ bind: () => () => undefined }, 'ns', dictionaries, 'zh');
  assert.equal(hollow.mode, 'local');
  assert.equal(hollow.t('title'), '壁纸');

  const throwing = createTranslator({ bind: () => { throw new Error('nope'); } }, 'ns', dictionaries, 'en');
  assert.equal(throwing.mode, 'local');
  assert.equal(throwing.t('title'), 'Wallpaper');

  const missing = createTranslator(null, 'ns', dictionaries, 'en');
  assert.equal(missing.mode, 'local');
  assert.equal(missing.t('title'), 'Wallpaper');
  // An unknown key is echoed rather than dropped, so a missing string is visible.
  assert.equal(missing.t('absent'), 'absent');
});

test('createTranslator matches a region tag onto the base dictionary', () => {
  const dictionaries = { zh: { title: '壁纸' }, en: { title: 'Wallpaper' } };
  assert.equal(createTranslator(null, 'ns', dictionaries, 'zh-CN').t('title'), '壁纸');
  assert.equal(createTranslator(null, 'ns', dictionaries, 'en-GB').t('title'), 'Wallpaper');
  // An unmatched preference still produces a usable page rather than blanks.
  assert.equal(createTranslator(null, 'ns', dictionaries, 'fr').t('title'), '壁纸');
});

/* ── client Slots ─────────────────────────────────────────────────────────── */

test('registerSlotSurface injects and registers under the same key', () => {
  const seen = [];
  const slots = {
    inject: (key, callback) => {
      seen.push(['inject', key]);
      callback();
      return () => seen.push(['dispose']);
    },
    register: (declaration) => {
      seen.push(['register', declaration]);
      return () => undefined;
    },
  };
  const component = () => null;
  const result = registerSlotSurface(slots, 'settings.section', { id: 'x', order: 1 }, component);
  assert.equal(result.ok, true);
  assert.deepEqual(seen[0], ['inject', 'settings.section']);
  // The declaration must not need `name` spelled twice: the key is the name.
  assert.deepEqual(seen[1], ['register', { id: 'x', order: 1, name: 'settings.section' }]);
  result.dispose();
  assert.deepEqual(seen.at(-1), ['dispose']);
});

test('registerSlotSurface records a throw instead of letting it escape apply()', () => {
  const slots = {
    inject: () => { throw new Error('no such slot'); },
    register: () => undefined,
  };
  const result = registerSlotSurface(slots, 'sidebar.footer.action', { id: 'x' }, () => null);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no such slot');
  assert.equal(typeof result.dispose, 'function');
});

test('registerSlotSurface refuses a slots service that is not one', () => {
  for (const value of [null, undefined, {}, { inject: () => undefined }]) {
    const result = registerSlotSurface(value, 'settings.section', { id: 'x' }, () => null);
    assert.equal(result.ok, false);
    assert.match(result.error, /slots/);
  }
});

/* ── host routes ──────────────────────────────────────────────────────────── */

test('registerPrefixRoute claims the prefix and hands back the harness disposer', () => {
  const calls = [];
  const webServer = { register: (route) => { calls.push(route); return () => calls.push('dispose'); } };
  const handler = () => undefined;
  const result = registerPrefixRoute(webServer, '/plugins/x', handler);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'disposer');
  assert.deepEqual(calls[0], { kind: 'prefix', path: '/plugins/x', handler });
  result.dispose();
  assert.equal(calls.at(-1), 'dispose');
});

test('registerPrefixRoute tolerates a register() that returns nothing', () => {
  // Some versions register the route and hand back no disposer; that is a
  // successful registration, and calling `undefined()` on teardown would be a
  // crash during unload.
  const result = registerPrefixRoute({ register: () => undefined }, '/plugins/x', () => undefined);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'no-disposer');
  assert.doesNotThrow(() => result.dispose());
});

test('registerPrefixRoute records a rejected registration rather than failing the fiber', () => {
  const result = registerPrefixRoute(
    { register: () => { throw new Error('webserver: duplicate prefix route'); } },
    '/plugins/x',
    () => undefined,
  );
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'none');
  assert.match(result.error, /duplicate/);
  assert.doesNotThrow(() => result.dispose());
});

test('registerPrefixRoute refuses a webServer that is not one', () => {
  for (const value of [null, undefined, {}, { register: 7 }]) {
    const result = registerPrefixRoute(value, '/plugins/x', () => undefined);
    assert.equal(result.ok, false);
    assert.match(result.error, /webServer/);
  }
});

/* ── the colour trap ──────────────────────────────────────────────────────── */

test('relativeLuminance and contrastRatio follow the WCAG definitions', () => {
  assert.equal(relativeLuminance('#ffffff'), 1);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(relativeLuminance('not a colour'), null);
  assert.equal(contrastRatio('#fff', 'not a colour'), null);
});

test('readableForeground refuses the theme colour when it would be invisible', () => {
  // The trap this exists for: DSH's brand primary is near-white on the dark
  // palette, so a hard-coded white is white-on-white.
  assert.equal(readableForeground('#ffffff', '#ffffff'), '#000000');
  assert.equal(readableForeground('#f5f5f5', '#ffffff'), '#000000');
  // …and near-black on the light palette, where a hard-coded black disappears.
  assert.equal(readableForeground('#0f0f0f', '#000000'), '#ffffff');
  assert.equal(readableForeground('#000000', '#000000'), '#ffffff');
});

test('readableForeground keeps the theme colour when it does pass', () => {
  assert.equal(readableForeground('#0f0f0f', '#ffffff'), '#ffffff');
  assert.equal(readableForeground('#ffffff', '#0f0f0f'), '#0f0f0f');
  assert.equal(readableForeground('#4d6bfe', '#ffffff'), '#ffffff');
});

test('readableForeground survives a theme that defines neither token', () => {
  // Both tokens missing: the button falls back to its own blue, and the text
  // must still be picked rather than left blank.
  assert.equal(readableForeground('#4d6bfe', ''), '#ffffff');
  assert.equal(readableForeground('', ''), '#ffffff');
  assert.equal(readableForeground('', '#0f0f0f'), '#0f0f0f');
  // An unparsable fill cannot be judged, so the theme's own answer is kept.
  assert.equal(readableForeground('color-mix(in srgb, red, blue)', '#123456'), '#123456');
});

/* ── host detection ───────────────────────────────────────────────────────── */

test('detectDshVersion answers without a context instead of throwing', () => {
  // The plugin may be applied by a host that provides no `loader` at all. The
  // detector must still return a printable answer.
  for (const ctx of [undefined, null, {}, { loader: {} }, { loader: { internal: {} } }]) {
    const result = detectDshVersion(ctx);
    assert.equal(typeof result.version, 'string');
    assert.equal(typeof result.source, 'string');
  }
});

test('detectDshVersion uses the Loader when it answers, and does not when it throws', () => {
  const good = {
    loader: {
      internal: {
        version: 'v2',
        resolveSync: () => ({ url: 'file:///nowhere/does-not-exist/package.json' }),
      },
    },
  };
  // Resolved but missing on disk: a path that does not exist is not evidence.
  assert.notEqual(detectDshVersion(good).source, 'loader');

  const throwing = {
    loader: { internal: { version: 'v2', resolveSync: () => { throw new Error('no resolution'); } } },
  };
  assert.doesNotThrow(() => detectDshVersion(throwing));
});

test('describeHostEnvironment reports the profile and never throws on a hostile context', () => {
  const environment = describeHostEnvironment({
    get: () => ({ name: 'desktop', home: 'C:\\Users\\x\\.dsh' }),
  });
  assert.equal(environment.profile, 'desktop');
  assert.equal(environment.home, 'C:\\Users\\x\\.dsh');
  assert.equal(environment.platform, process.platform);
  assert.equal(environment.node, process.versions.node);
  assert.ok(['verified', 'untested', 'unknown'].includes(environment.dshVersionStatus));

  const hostile = describeHostEnvironment({ get: () => { throw new Error('locked'); } });
  assert.match(hostile.profile, /locked/);
});

test('createHostCompat starts pending and reports what the effect recorded', () => {
  const compat = createHostCompat({ dshVersion: '0.1.7-rc.2' });
  // Pending, not "failed": the route is claimed inside a Cordis effect, so at
  // construction time the honest answer is that it is not known yet.
  assert.equal(compat.routes.ok, false);
  assert.equal(compat.routes.mode, 'pending');

  compat.setRoutes({ ok: true, mode: 'disposer', error: '' });
  assert.equal(compat.routes.ok, true);
  assert.equal(compat.routes.mode, 'disposer');
  assert.equal(compat.environment.dshVersion, '0.1.7-rc.2');
});
