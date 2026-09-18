/*
 * The shared vocabulary is the contract between the two halves and the only
 * definition of "a valid configuration", so it carries the densest tests here.
 * The cases that matter most are the ones where a plausible implementation is
 * silently wrong: a category mask that can reach zero, a purity mask that can
 * turn SFW off, and an image allowlist that accepts a lookalike host.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATEGORY_KEYS,
  CONFIG_DEFAULTS,
  IMAGE_HOSTS,
  PURITY_KEYS,
  buildSearchParams,
  fadeColor,
  flagsToMask,
  isAllowedImageUrl,
  maskToFlags,
  normalizeConfig,
  normalizeWallpaper,
  parseColor,
  parseSearchResponse,
  searchItemToWallpaper,
  surfaceOverrideSelector,
} from '../src/shared/constants.js';

test('maskToFlags reads wallhaven positional flags and defaults missing ones to on', () => {
  assert.deepEqual(maskToFlags('111', 3), [true, true, true]);
  assert.deepEqual(maskToFlags('100', 3), [true, false, false]);
  assert.deepEqual(maskToFlags('1', 3), [true, true, true]);
  assert.deepEqual(maskToFlags('', 3), [true, true, true]);
  assert.deepEqual(maskToFlags(undefined, 3), [true, true, true]);
});

test('flagsToMask round-trips and always emits the full width', () => {
  assert.equal(flagsToMask([true, false, true]), '101');
  assert.equal(flagsToMask([false, false, false]), '000');
  assert.deepEqual(maskToFlags(flagsToMask([false, true, false]), 3), [false, true, false]);
});

test('normalizeConfig refuses to store a purity without SFW', () => {
  // The API would happily accept `011`; a plugin must not persist it.
  const config = normalizeConfig({ purity: '011' }, CONFIG_DEFAULTS);
  assert.equal(config.purity, '111');
  assert.equal(maskToFlags(normalizeConfig({ purity: '000' }, CONFIG_DEFAULTS).purity, 3)[0], true);
});

test('normalizeConfig refuses to store an empty category selection', () => {
  // wallhaven cannot express "no categories" and would return nothing at all,
  // which reads to the user as "wallhaven is broken".
  assert.equal(normalizeConfig({ categories: '000' }, CONFIG_DEFAULTS).categories, '100');
});

test('normalizeConfig clamps the numeric appearance controls', () => {
  assert.equal(normalizeConfig({ surfaceOpacity: 5 }, CONFIG_DEFAULTS).surfaceOpacity, 1);
  assert.equal(normalizeConfig({ surfaceOpacity: -3 }, CONFIG_DEFAULTS).surfaceOpacity, 0);
  assert.equal(normalizeConfig({ blur: 999 }, CONFIG_DEFAULTS).blur, 60);
  assert.equal(normalizeConfig({ blur: -1 }, CONFIG_DEFAULTS).blur, 0);
  assert.equal(normalizeConfig({ scrim: 9 }, CONFIG_DEFAULTS).scrim, 0.9);
  assert.equal(normalizeConfig({ surfaceOpacity: 'nonsense' }, CONFIG_DEFAULTS).surfaceOpacity, CONFIG_DEFAULTS.surfaceOpacity);
});

test('normalizeConfig keeps the previous value when an enum is unknown', () => {
  const base = normalizeConfig({ sorting: 'views', fit: 'contain' }, CONFIG_DEFAULTS);
  assert.equal(normalizeConfig({ sorting: 'cheapest', fit: 'diagonal' }, base).sorting, 'views');
  assert.equal(normalizeConfig({ sorting: 'cheapest', fit: 'diagonal' }, base).fit, 'contain');
});

test('normalizeConfig only stores a proxy this plugin can actually tunnel through', () => {
  assert.equal(normalizeConfig({ proxy: 'http://127.0.0.1:7897' }, CONFIG_DEFAULTS).proxy, 'http://127.0.0.1:7897');
  assert.equal(normalizeConfig({ proxy: 'https://proxy.local:8443' }, CONFIG_DEFAULTS).proxy, 'https://proxy.local:8443');
  // A SOCKS proxy is a shape this plugin cannot honour; storing it would fail
  // later with a confusing error instead of here with a clear one.
  assert.equal(normalizeConfig({ proxy: 'socks5://127.0.0.1:1080' }, CONFIG_DEFAULTS).proxy, '');
  assert.equal(normalizeConfig({ proxy: '127.0.0.1:7897' }, CONFIG_DEFAULTS).proxy, '');
});

test('normalizeConfig normalizes search-shaped fields', () => {
  assert.equal(normalizeConfig({ atleast: '2560x1440' }, CONFIG_DEFAULTS).atleast, '2560x1440');
  assert.equal(normalizeConfig({ atleast: 'huge' }, CONFIG_DEFAULTS).atleast, CONFIG_DEFAULTS.atleast);
  assert.equal(normalizeConfig({ colors: '#AABBCC' }, CONFIG_DEFAULTS).colors, 'aabbcc');
  assert.equal(normalizeConfig({ colors: 'nope' }, CONFIG_DEFAULTS).colors, '');
  assert.equal(normalizeConfig({ ratios: '16x9' }, CONFIG_DEFAULTS).ratios, '16x9');
  assert.equal(normalizeConfig({ ratios: 'wide' }, CONFIG_DEFAULTS).ratios, '');
});

test('normalizeConfig drops unknown keys instead of carrying them forward', () => {
  const config = normalizeConfig({ somethingRemoved: true, blur: 3 }, CONFIG_DEFAULTS);
  assert.equal('somethingRemoved' in config, false);
  assert.equal(config.blur, 3);
});

test('normalizeConfig merges onto the given base rather than the defaults', () => {
  const base = normalizeConfig({ query: 'mountains', blur: 8 }, CONFIG_DEFAULTS);
  const next = normalizeConfig({ blur: 0 }, base);
  assert.equal(next.query, 'mountains');
  assert.equal(next.blur, 0);
});

test('isAllowedImageUrl accepts exactly wallhaven image hosts over https', () => {
  for (const host of IMAGE_HOSTS) {
    assert.equal(isAllowedImageUrl(`https://${host}/full/ab/wallhaven-abc123.jpg`), true);
  }
  // The classic allowlist bypasses: a lookalike suffix, a userinfo prefix, and
  // plain http.
  assert.equal(isAllowedImageUrl('https://evil.example/w.wallhaven.cc/x.jpg'), false);
  assert.equal(isAllowedImageUrl('https://w.wallhaven.cc.evil.example/x.jpg'), false);
  assert.equal(isAllowedImageUrl('https://w.wallhaven.cc@evil.example/x.jpg'), false);
  assert.equal(isAllowedImageUrl('http://w.wallhaven.cc/x.jpg'), false);
  assert.equal(isAllowedImageUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedImageUrl('not a url'), false);
  assert.equal(isAllowedImageUrl(''), false);
  assert.equal(isAllowedImageUrl(null), false);
  assert.equal(isAllowedImageUrl(`https://w.wallhaven.cc/${'a'.repeat(3000)}.jpg`), false);
});

test('normalizeWallpaper requires an allowed original and drops decoration it cannot use', () => {
  const record = normalizeWallpaper({
    id: 'abc123',
    full: 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg',
    thumb: 'https://th.wallhaven.cc/small/ab/abc123.jpg',
    preview: 'https://evil.example/x.jpg',
    resolution: '1920x1080',
    dimensionX: 1920,
    dimensionY: 1080,
    fileSize: 42,
    fileType: 'image/jpeg',
    category: 'anime',
    purity: 'sfw',
    colors: ['#ffffff', 'not-a-colour'],
  });
  assert.equal(record.id, 'abc123');
  assert.equal(record.preview, '');
  assert.deepEqual(record.colors, ['#ffffff']);
  assert.equal(record.pageUrl, 'https://wallhaven.cc/w/abc123');

  // No usable original means nothing to wear and nothing to download.
  assert.equal(normalizeWallpaper({ id: 'abc123', full: 'https://evil.example/x.jpg' }), null);
  assert.equal(normalizeWallpaper({ id: '', full: 'https://w.wallhaven.cc/x.jpg' }), null);
  assert.equal(normalizeWallpaper(null), null);
  assert.equal(normalizeWallpaper([]), null);
});

test('normalizeWallpaper ignores a page URL that is not a wallhaven page', () => {
  const record = normalizeWallpaper({
    id: 'abc123',
    full: 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg',
    pageUrl: 'javascript:alert(1)',
  });
  assert.equal(record.pageUrl, 'https://wallhaven.cc/w/abc123');
});

test('buildSearchParams emits only the parameters the current sorting understands', () => {
  const params = buildSearchParams(normalizeConfig({ sorting: 'toplist', topRange: '3M' }, CONFIG_DEFAULTS), 2, '');
  assert.equal(params.get('sorting'), 'toplist');
  assert.equal(params.get('topRange'), '3M');
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('purity'), '100');

  const random = buildSearchParams(normalizeConfig({ sorting: 'random' }, CONFIG_DEFAULTS), 1, '');
  assert.equal(random.get('topRange'), null);
});

test('buildSearchParams passes a seed only when it is a real wallhaven seed', () => {
  const config = normalizeConfig({}, CONFIG_DEFAULTS);
  assert.equal(buildSearchParams(config, 1, 'aB3xY9').get('seed'), 'aB3xY9');
  assert.equal(buildSearchParams(config, 1, 'too-long-seed').get('seed'), null);
  assert.equal(buildSearchParams(config, 1, '').get('seed'), null);
});

test('buildSearchParams asks for a page of at least 1', () => {
  const config = normalizeConfig({}, CONFIG_DEFAULTS);
  assert.equal(buildSearchParams(config, 0, '').get('page'), '1');
  assert.equal(buildSearchParams(config, -7, '').get('page'), '1');
});

test('parseSearchResponse reshapes a real payload and keeps the seed', () => {
  const payload = JSON.parse(`{
    "data": [{
      "id": "94x38z",
      "url": "https://wallhaven.cc/w/94x38z",
      "purity": "sfw",
      "category": "anime",
      "dimension_x": 6742,
      "dimension_y": 3534,
      "resolution": "6742x3534",
      "file_size": 5070446,
      "file_type": "image/jpeg",
      "colors": ["#000000"],
      "path": "https://w.wallhaven.cc/full/94/wallhaven-94x38z.jpg",
      "thumbs": {
        "large": "https://th.wallhaven.cc/lg/94/94x38z.jpg",
        "small": "https://th.wallhaven.cc/small/94/94x38z.jpg"
      }
    }],
    "meta": { "current_page": 3, "last_page": 36, "per_page": 24, "total": 848, "seed": "aB3xY9" }
  }`);
  const parsed = parseSearchResponse(payload);
  assert.equal(parsed.page, 3);
  assert.equal(parsed.lastPage, 36);
  assert.equal(parsed.total, 848);
  assert.equal(parsed.seed, 'aB3xY9');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, '94x38z');
  assert.equal(parsed.items[0].full, 'https://w.wallhaven.cc/full/94/wallhaven-94x38z.jpg');
  assert.equal(parsed.items[0].thumb, 'https://th.wallhaven.cc/small/94/94x38z.jpg');
});

test('parseSearchResponse reports a malformed payload rather than an empty result', () => {
  assert.equal(parseSearchResponse(null), null);
  assert.equal(parseSearchResponse({}), null);
  assert.equal(parseSearchResponse({ data: 'nope' }), null);
  const empty = parseSearchResponse({ data: [], meta: {} });
  assert.equal(empty.items.length, 0);
  assert.equal(empty.page, 1);
  assert.equal(empty.seed, '');
});

test('searchItemToWallpaper drops rows whose original is not fetchable', () => {
  assert.equal(searchItemToWallpaper({ id: 'abc123', path: 'https://evil.example/x.jpg' }), null);
  assert.equal(searchItemToWallpaper(null), null);
});

test('parseColor understands the forms a computed custom property produces', () => {
  assert.deepEqual(parseColor('#ffffff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('#151517'), [21, 21, 23, 1]);
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3, 1]);
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), [1, 2, 3, 0.5]);
  assert.deepEqual(parseColor('rgb(255 255 255 / 20%)'), [255, 255, 255, 0.2]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  assert.equal(parseColor('color-mix(in srgb, red, blue)'), null);
  assert.equal(parseColor(''), null);
  assert.equal(parseColor(undefined), null);
});

test('fadeColor lowers alpha without touching the colour, and refuses unknowns', () => {
  assert.equal(fadeColor('#ffffff', 0.72), 'rgba(255, 255, 255, 0.720)');
  assert.equal(fadeColor('#151517', 0.5), 'rgba(21, 21, 23, 0.500)');
  // Never brightens: an already translucent token stays at most as opaque.
  assert.equal(fadeColor('rgba(255, 255, 255, 0.4)', 1), 'rgba(255, 255, 255, 0.400)');
  assert.equal(fadeColor('#ffffff', 2), 'rgba(255, 255, 255, 1.000)');
  assert.equal(fadeColor('var(--x)', 0.5), null);
});

test('the surface override targets body, where the theme actually sets the alias tokens', () => {
  // DSH puts the light palette on `body` and the dark one on
  // `body[data-ds-dark-theme]`. An override on `:root` alone would only be
  // inherited, and an inherited value loses to the theme's own.
  const light = surfaceOverrideSelector(false);
  const dark = surfaceOverrideSelector(true);
  assert.match(light, /(^|,\s*)html:root body$/);
  assert.match(dark, /html:root body\[data-ds-dark-theme\]/);
  // Out-specifying the theme's own rule is the point: (0,1,1) for light,
  // (0,2,2) for dark.
  assert.equal(light.includes('body[data-ds-dark-theme]'), false);
});

test('the default configuration is SFW-only, keyless and off', () => {
  assert.equal(CONFIG_DEFAULTS.purity, '100');
  assert.equal(CONFIG_DEFAULTS.apiKey, '');
  assert.equal(CONFIG_DEFAULTS.enabled, false);
  assert.equal(CONFIG_DEFAULTS.wallpaper, null);
  assert.equal(CATEGORY_KEYS.length, 3);
});
