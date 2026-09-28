window.__ModuleLoader__.load({ id: "dsh-wallhaven-wallpaper", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
// src/shared/constants.js (inlined — export keywords stripped)
/*
 * Shared vocabulary of `dsh-wallhaven-wallpaper`.
 *
 * ★ This file is loaded twice, in two different ways, and must stay valid for
 *   both:
 *     · the host half imports it as an ordinary ES module;
 *     · the client half gets it **inlined** into its module-factory body by
 *       `scripts/build.mjs`, which strips the `export ` keywords.
 *   So: no `import`, no top-level `await`, no non-exported module state that
 *   the other half would need. Plain declarations only.
 *
 * Sharing it is the point. The page and the host must agree, byte for byte, on
 * what a valid configuration is, which wallhaven parameters a configuration
 * turns into, and which image hosts are allowed to be fetched — otherwise the
 * "what you see" and "what is saved" copies drift apart.
 */

/** The package name; also the client module id and the loader row id. */
const PKG = 'dsh-wallhaven-wallpaper';

/** Every host route this plugin owns lives under this prefix. */
const ROUTE_BASE = '/plugins/dsh-wallhaven-wallpaper';

/** wallhaven's public API v1. */
const API_BASE = 'https://wallhaven.cc/api/v1';

/**
 * The only hosts the host half will fetch image bytes from.
 *
 * The browser never talks to wallhaven itself: it asks this plugin's own
 * `/image` route, which fetches the URL server-side. That is what makes the
 * plugin work when the browser cannot reach wallhaven (blocked DNS, no proxy
 * configured for the page) and what keeps a stray `src` from turning the route
 * into an open relay.
 */
const IMAGE_HOSTS = ['w.wallhaven.cc', 'th.wallhaven.cc'];

/** wallhaven search: `categories` is three positional flags, in this order. */
const CATEGORY_KEYS = ['general', 'anime', 'people'];

/** wallhaven search: `purity` is three positional flags, in this order. */
const PURITY_KEYS = ['sfw', 'sketchy', 'nsfw'];

/** wallhaven search: `sorting` values accepted by the API. */
const SORTINGS = ['date_added', 'relevance', 'random', 'views', 'favorites', 'toplist'];

/** wallhaven search: `order` values accepted by the API. */
const ORDERS = ['desc', 'asc'];

/** wallhaven search: `topRange` values; only meaningful with `sorting=toplist`. */
const TOP_RANGES = ['1d', '3d', '1w', '1M', '3M', '6M', '1y'];

/** Offered in the page's resolution picker; `''` means "no minimum". */
const ATLEAST_CHOICES = ['', '1920x1080', '2560x1440', '3440x1440', '3840x2160'];

/** Offered in the page's ratio picker; `''` means "any ratio". */
const RATIO_CHOICES = ['', '16x9', '16x10', '21x9', '9x16', '1x1'];

/**
 * Loopback ports an HTTP proxy client commonly listens on.
 *
 * The connectivity test tries these when nothing is configured, because the
 * commonest reason wallhaven "just does not connect" is not a broken network:
 * it is a machine whose only egress is a local proxy client, launched from a
 * GUI that never inherited `HTTPS_PROXY`. Finding the port is the difference
 * between "go look up an address and type it in" and "it works".
 *
 * All of these are HTTP proxy ports. SOCKS ports are deliberately absent — this
 * plugin only speaks `CONNECT`, so offering a SOCKS port would be offering
 * something that cannot work. Ordered by how often each is the right answer.
 */
const LOCAL_PROXY_PORTS = [7897, 7890, 7891, 10809, 2080, 6152, 8118, 8080, 3128];

/** How long one loopback port check may take, in milliseconds. */
const LOCAL_PROXY_PROBE_MS = 400;

/** How the wallpaper is scaled onto the viewport. */
const FITS = ['cover', 'contain', 'fill', 'tile'];

/** How the wallpaper is anchored when it does not fill the viewport. */
const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];

/** A page of wallhaven search results is always 24 items. */
const PER_PAGE = 24;

/**
 * The resolved configuration, with every default in one place.
 *
 * `wallpaper` is the currently worn image (or `null`). It is stored resolved —
 * thumbnail URL, original URL, resolution, colours — rather than as an id, so
 * that reloading the page can repaint the background without a single network
 * call to wallhaven.
 */
const CONFIG_DEFAULTS = {
  /* ── what to search ─────────────────────────────────────────────────── */
  query: '',
  categories: '111',
  purity: '100',
  sorting: 'toplist',
  order: 'desc',
  topRange: '1M',
  atleast: '1920x1080',
  ratios: '',
  colors: '',

  /* ── how to reach wallhaven ─────────────────────────────────────────── */
  /** wallhaven API key; only needed for sketchy/nsfw and saved filters. */
  apiKey: '',
  /** Explicit proxy, e.g. `http://127.0.0.1:7897`. Empty = use env, then direct. */
  proxy: '',

  /* ── how the shell looks ────────────────────────────────────────────── */
  /** Whether the wallpaper is worn at all. */
  enabled: false,
  /** 0 = glass (wallpaper fully visible), 1 = opaque (wallpaper hidden). */
  surfaceOpacity: 0.72,
  /** Gaussian blur radius applied to the wallpaper, in px. */
  blur: 0,
  /** Strength of the darkening veil between wallpaper and shell, 0…1. */
  scrim: 0.18,
  fit: 'cover',
  position: 'center',

  /* ── where originals are saved ──────────────────────────────────────── */
  /** Empty = `<Pictures>/DSH Wallpapers`. */
  downloadDir: '',

  /* ── the image currently worn ───────────────────────────────────────── */
  wallpaper: null,
};

/** Anchors the route `<img>`/`background-image` URLs so a stale one is obvious. */
const THUMB_SIZE = 'thumb';
const PREVIEW_SIZE = 'preview';
const FULL_SIZE = 'full';

/**
 * Turn a wallhaven positional flag string into booleans.
 *
 * `'101'` → `[true, false, true]`. Anything shorter than `length` is padded
 * with `true`, which is the API's own default posture.
 *
 * @param mask - the positional flag string, e.g. wallhaven's `categories`.
 * @param length - how many flags the field has (3 for both categories and purity).
 * @returns one boolean per position.
 */
function maskToFlags(mask, length) {
  const text = typeof mask === 'string' ? mask : '';
  const flags = [];
  for (let index = 0; index < length; index += 1) {
    const char = text.charAt(index);
    flags.push(char === '' ? true : char === '1');
  }
  return flags;
}

/**
 * The inverse of {@link maskToFlags}: booleans back to a positional string.
 *
 * @param flags - one boolean per position.
 * @returns the positional flag string, e.g. `'110'`.
 */
function flagsToMask(flags) {
  let mask = '';
  for (const flag of flags) mask += flag ? '1' : '0';
  return mask;
}

/** Clamp a number into `[min, max]`, falling back when it is not a number. */
function clampNumber(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Keep only the string if it is one of `allowed`, else the fallback. */
function oneOf(value, allowed, fallback) {
  return typeof value === 'string' && allowed.indexOf(value) >= 0 ? value : fallback;
}

/** A trimmed string, or the fallback when the value is not a string. */
function trimmed(value, fallback) {
  return typeof value === 'string' ? value.trim() : fallback;
}

/**
 * Whether a URL is one this plugin is willing to fetch image bytes from.
 *
 * HTTPS only, exact host allowlist. Used by the host half on every `/image` and
 * `/download` request, and by {@link normalizeWallpaper} when a selection is
 * saved, so an unusable URL is rejected at the two places it could enter.
 *
 * @param value - the candidate URL.
 * @returns whether it may be fetched.
 */
function isAllowedImageUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && IMAGE_HOSTS.indexOf(url.hostname) >= 0;
}

/**
 * Normalize the stored wallpaper record, or reject it.
 *
 * A selection is only usable if it carries an allowed `full` URL — that URL is
 * both the background and the download source. Everything else is decoration
 * and is dropped rather than repaired.
 *
 * @param value - the candidate record.
 * @returns a normalized record, or `null` when it cannot be worn.
 */
function normalizeWallpaper(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value;
  const id = trimmed(row['id'], '');
  const full = trimmed(row['full'], '');
  if (id === '' || !isAllowedImageUrl(full)) return null;

  const thumb = trimmed(row['thumb'], '');
  const preview = trimmed(row['preview'], '');
  const colors = Array.isArray(row['colors'])
    ? row['colors'].filter((color) => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)).slice(0, 6)
    : [];

  const dimensionX = clampNumber(row['dimensionX'], 0, 100000, 0);
  const dimensionY = clampNumber(row['dimensionY'], 0, 100000, 0);

  return {
    id,
    full,
    thumb: isAllowedImageUrl(thumb) ? thumb : '',
    preview: isAllowedImageUrl(preview) ? preview : '',
    pageUrl: /^https:\/\/wallhaven\.cc\/w\/[A-Za-z0-9]+$/.test(trimmed(row['pageUrl'], ''))
      ? trimmed(row['pageUrl'], '')
      : `https://wallhaven.cc/w/${id}`,
    resolution: trimmed(row['resolution'], dimensionX > 0 ? `${String(dimensionX)}x${String(dimensionY)}` : ''),
    dimensionX,
    dimensionY,
    fileSize: clampNumber(row['fileSize'], 0, 1e12, 0),
    fileType: trimmed(row['fileType'], ''),
    category: oneOf(row['category'], CATEGORY_KEYS, 'general'),
    purity: oneOf(row['purity'], PURITY_KEYS, 'sfw'),
    colors,
    /** When the user picked it, as an ISO string; `''` for a hand-edited record. */
    chosenAt: trimmed(row['chosenAt'], ''),
  };
}

/**
 * Merge a partial configuration onto the current one, validating every field.
 *
 * This is the single definition of "a valid configuration": the host runs it on
 * every write, and the page runs it on every optimistic local update. Unknown
 * keys are dropped, so a stale page cannot resurrect a field this version no
 * longer has.
 *
 * @param raw - the partial (or full) configuration to apply.
 * @param base - what to merge onto; defaults to {@link CONFIG_DEFAULTS}.
 * @returns the merged configuration.
 */
function normalizeConfig(raw, base) {
  const current = typeof base === 'object' && base !== null ? base : CONFIG_DEFAULTS;
  const next = {};
  for (const key of Object.keys(CONFIG_DEFAULTS)) next[key] = current[key];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return next;
  const patch = raw;

  if ('query' in patch) next.query = trimmed(patch['query'], next.query).slice(0, 200);

  if ('categories' in patch) {
    const flags = maskToFlags(trimmed(patch['categories'], next.categories), CATEGORY_KEYS.length);
    // An empty category selection cannot be expressed to wallhaven and would
    // silently return nothing; fall back to `general` instead of saving it.
    next.categories = flags.some(Boolean) ? flagsToMask(flags) : '100';
  }
  if ('purity' in patch) {
    const flags = maskToFlags(trimmed(patch['purity'], next.purity), PURITY_KEYS.length);
    // SFW is selectable like the other two — turning it off is a legitimate
    // choice (sketchy-only, say), and the API expresses it fine. What is *not*
    // storable is an empty selection: wallhaven cannot express "no purity" and
    // would return nothing, which reads as "search is broken" rather than "you
    // turned everything off". So the guard is "at least one", same as
    // categories — not "SFW forever".
    next.purity = flags.some(Boolean) ? flagsToMask(flags) : '100';
  }

  if ('sorting' in patch) next.sorting = oneOf(patch['sorting'], SORTINGS, next.sorting);
  if ('order' in patch) next.order = oneOf(patch['order'], ORDERS, next.order);
  if ('topRange' in patch) next.topRange = oneOf(patch['topRange'], TOP_RANGES, next.topRange);
  if ('atleast' in patch) {
    const value = trimmed(patch['atleast'], next.atleast);
    next.atleast = value === '' || /^\d{3,5}x\d{3,5}$/.test(value) ? value : next.atleast;
  }
  if ('ratios' in patch) {
    const value = trimmed(patch['ratios'], next.ratios);
    next.ratios = value === '' || /^\d{1,2}x\d{1,2}$/.test(value) ? value : next.ratios;
  }
  if ('colors' in patch) {
    const value = trimmed(patch['colors'], next.colors).replace(/^#/, '').toLowerCase();
    next.colors = value === '' || /^[0-9a-f]{6}$/.test(value) ? value : next.colors;
  }

  if ('apiKey' in patch) next.apiKey = trimmed(patch['apiKey'], next.apiKey).slice(0, 128);
  if ('proxy' in patch) {
    const value = trimmed(patch['proxy'], next.proxy);
    // Only the shapes this plugin can actually tunnel through are storable, so
    // a typo fails at save time instead of at the first search. HTTP(S) proxies
    // only: `http://` is the scheme a CONNECT tunnel speaks even when it fronts
    // an HTTPS target.
    next.proxy = value === '' || /^https?:\/\/[^\s/]+(:\d+)?$/.test(value) ? value : next.proxy;
  }

  if ('enabled' in patch) next.enabled = patch['enabled'] === true;
  if ('surfaceOpacity' in patch) next.surfaceOpacity = clampNumber(patch['surfaceOpacity'], 0, 1, next.surfaceOpacity);
  if ('blur' in patch) next.blur = clampNumber(patch['blur'], 0, 60, next.blur);
  if ('scrim' in patch) next.scrim = clampNumber(patch['scrim'], 0, 0.9, next.scrim);
  if ('fit' in patch) next.fit = oneOf(patch['fit'], FITS, next.fit);
  if ('position' in patch) next.position = oneOf(patch['position'], POSITIONS, next.position);

  if ('downloadDir' in patch) next.downloadDir = trimmed(patch['downloadDir'], next.downloadDir).slice(0, 512);

  if ('wallpaper' in patch) {
    // Explicit `null` clears the worn image; anything unusable clears it too,
    // because a half-valid record cannot be rendered or downloaded.
    next.wallpaper = patch['wallpaper'] === null ? null : normalizeWallpaper(patch['wallpaper']);
  }

  return next;
}

/**
 * Build the wallhaven `/search` query for one page.
 *
 * Pure and total: the result depends only on its arguments, so the page can
 * show the user the exact request it is about to make and the host can build
 * the same one without asking the page.
 *
 * @param config - a normalized configuration.
 * @param page - 1-based page number.
 * @param seed - optional random seed, passed back for a stable ordering.
 * @returns the query parameters, `apikey` excluded (it travels as a header).
 */
function buildSearchParams(config, page, seed) {
  const params = new URLSearchParams();
  if (config.query !== '') params.set('q', config.query);
  params.set('categories', config.categories);
  params.set('purity', config.purity);
  params.set('sorting', config.sorting);
  params.set('order', config.order);
  if (config.sorting === 'toplist') params.set('topRange', config.topRange);
  if (config.atleast !== '') params.set('atleast', config.atleast);
  if (config.ratios !== '') params.set('ratios', config.ratios);
  if (config.colors !== '') params.set('colors', config.colors);
  params.set('page', String(Math.max(1, Math.floor(page))));
  if (typeof seed === 'string' && /^[A-Za-z0-9]{6}$/.test(seed)) params.set('seed', seed);
  return params;
}

/**
 * Reshape one wallhaven search result into the record this plugin stores.
 *
 * The host keeps wallhaven's own field names out of the page: everything the UI
 * renders is named here, and `thumb`/`preview`/`full` are absolute wallhaven
 * URLs that {@link isAllowedImageUrl} accepts.
 *
 * @param row - one element of wallhaven's `data` array.
 * @returns a normalized wallpaper record, or `null` when unusable.
 */
function searchItemToWallpaper(row) {
  if (typeof row !== 'object' || row === null) return null;
  const thumbs = typeof row['thumbs'] === 'object' && row['thumbs'] !== null ? row['thumbs'] : {};
  return normalizeWallpaper({
    id: row['id'],
    full: row['path'],
    thumb: thumbs['small'],
    preview: thumbs['large'],
    pageUrl: row['url'],
    resolution: row['resolution'],
    dimensionX: row['dimension_x'],
    dimensionY: row['dimension_y'],
    fileSize: row['file_size'],
    fileType: row['file_type'],
    category: row['category'],
    purity: row['purity'],
    colors: row['colors'],
    chosenAt: '',
  });
}

/**
 * Parse one wallhaven search response into this plugin's wire shape.
 *
 * A malformed page is reported as an error rather than rendered as an empty
 * result list: "no wallpapers matched" and "the response was not understood"
 * are different facts, and only one of them means the user should change the
 * query.
 *
 * @param payload - the decoded JSON body.
 * @returns `{ items, page, lastPage, total, seed }`, or `null` when unusable.
 */
function parseSearchResponse(payload) {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = payload['data'];
  if (!Array.isArray(data)) return null;
  const meta = typeof payload['meta'] === 'object' && payload['meta'] !== null ? payload['meta'] : {};

  const items = [];
  for (const row of data) {
    const item = searchItemToWallpaper(row);
    if (item !== null) items.push(item);
  }

  const page = clampNumber(meta['current_page'], 1, 100000, 1);
  const lastPage = clampNumber(meta['last_page'], 1, 100000, page);
  const total = clampNumber(meta['total'], 0, 1e9, items.length);
  const seed = typeof meta['seed'] === 'string' && /^[A-Za-z0-9]{6}$/.test(meta['seed']) ? meta['seed'] : '';

  return { items, page, lastPage, total, seed };
}

/**
 * Parse `#rrggbb` / `#rgb` / `rgb()` / `rgba()` into `[r, g, b, a]`.
 *
 * Only the forms a computed CSS custom property can actually produce are
 * accepted; anything else returns `null` so the caller can leave the original
 * token alone rather than write a broken colour into it.
 *
 * @param value - a CSS colour string.
 * @returns the components, or `null`.
 */
function parseColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return [0, 0, 0, 0];
  if (text === 'white') return [255, 255, 255, 1];
  if (text === 'black') return [0, 0, 0, 1];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex !== null) {
    const digits = hex[1];
    const expand = digits.length === 3;
    const parts = expand
      ? digits.split('').map((char) => parseInt(char + char, 16))
      : [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16));
    const alpha = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return [parts[0], parts[1], parts[2], alpha];
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(text);
  if (fn !== null) {
    const body = fn[1].replace(/\//g, ' ').split(/[\s,]+/).filter((part) => part !== '');
    if (body.length < 3) return null;
    const channel = (part) => {
      if (part.endsWith('%')) return Math.round((parseFloat(part) / 100) * 255);
      return Math.round(parseFloat(part));
    };
    const channels = [channel(body[0]), channel(body[1]), channel(body[2])];
    if (channels.some((n) => !Number.isFinite(n))) return null;
    let alpha = 1;
    if (body.length >= 4) {
      const raw = body[3];
      alpha = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    }
    if (!Number.isFinite(alpha)) return null;
    return [
      Math.min(255, Math.max(0, channels[0])),
      Math.min(255, Math.max(0, channels[1])),
      Math.min(255, Math.max(0, channels[2])),
      Math.min(1, Math.max(0, alpha)),
    ];
  }

  return null;
}

/**
 * The selector this plugin writes its translucent surface tokens under.
 *
 * This is load-bearing, and it is not `:root`. DSH defines its alias tokens on
 * `body` for the light palette and on `body[data-ds-dark-theme]` for the dark
 * one, so a custom property set on `html` is merely inherited — and an inherited
 * value always loses to the one the theme sets directly on `body`. Targeting
 * `body` (and out-specifying the dark rule) is what makes the override take.
 *
 * `html:root` is included as well so any element reading a token above `body`
 * sees the same value.
 *
 * @param isDark - whether the dark palette is currently in force.
 * @returns a selector list.
 */
function surfaceOverrideSelector(isDark) {
  return isDark ? 'html:root, html:root body[data-ds-dark-theme]' : 'html:root, html:root body';
}

/**
 * Re-emit a colour at a different alpha, preserving its hue.
 *
 * This is how the wallpaper stays visible: the shell's own surface tokens are
 * read back from the live theme and rewritten with a lower alpha, so the
 * product keeps choosing the colour and this plugin only chooses how much of
 * the wallpaper shows through it.
 *
 * @param value - the original CSS colour.
 * @param factor - multiplier applied to the original alpha.
 * @returns an `rgba(...)` string, or `null` when the colour was not understood.
 */
function fadeColor(value, factor) {
  const parsed = parseColor(value);
  if (parsed === null) return null;
  const alpha = Math.min(1, Math.max(0, parsed[3] * factor));
  return `rgba(${String(parsed[0])}, ${String(parsed[1])}, ${String(parsed[2])}, ${alpha.toFixed(3)})`;
}

/**
 * WCAG relative luminance of a colour, ignoring its alpha.
 *
 * @param value - a CSS colour string.
 * @returns `0`…`1`, or `null` when the colour was not understood.
 */
function relativeLuminance(value) {
  const parsed = parseColor(value);
  if (parsed === null) return null;
  const linear = (raw) => {
    const channel = raw / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(parsed[0]) + 0.7152 * linear(parsed[1]) + 0.0722 * linear(parsed[2]);
}

/**
 * WCAG contrast ratio between two colours.
 *
 * @param a - one CSS colour.
 * @param b - the other.
 * @returns `1`…`21`, or `null` when either colour was not understood.
 */
function contrastRatio(a, b) {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  if (left === null || right === null) return null;
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

/**
 * Pick a foreground that is actually readable on `background`.
 *
 * This exists because of one specific trap. The primary button's text colour
 * comes from `--dsw-alias-label-primary-inverted`, which is the *paired* token
 * for `--dsw-alias-brand-primary` — and that pair is neutral and inverting: near
 * black on the light palette, near white on the dark one. So a hard-coded white
 * is white-on-white on the dark palette, and a hard-coded black is
 * black-on-black on the light one.
 *
 * The token is also undocumented (it is not in DSH's published token registry),
 * so it can vanish from a future theme without warning. Reading it and then
 * *checking* it — rather than trusting it, or replacing it with a constant —
 * is what keeps the button readable across palettes and across DSH versions.
 *
 * @param background - the fill the text sits on.
 * @param preferred - the token value the theme offers, if any.
 * @param minimum - the ratio below which `preferred` is rejected; defaults to
 *   the WCAG AA threshold for normal text.
 * @returns a CSS colour: `preferred` when it passes, else black or white.
 */
function readableForeground(background, preferred, minimum) {
  const floor = typeof minimum === 'number' ? minimum : 4.5;
  if (typeof preferred === 'string' && preferred !== '') {
    const ratio = contrastRatio(preferred, background);
    if (ratio !== null && ratio >= floor) return preferred;
  }
  const luminance = relativeLuminance(background);
  // An unreadable background cannot be judged, so keep what the theme offered.
  if (luminance === null) return typeof preferred === 'string' && preferred !== '' ? preferred : '#ffffff';
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

// src/shared/compat.js (inlined — export keywords stripped)
/*
 * Version adaptation: how this plugin survives a DSH it was not built against.
 *
 * ★ Same two-way loading rule as `./constants.js`: the host half imports this
 *   as an ES module, and the client half gets it **inlined** by
 *   `scripts/build.mjs` with its `export ` keywords stripped. So: no `import`,
 *   no top-level `await`, plain declarations only.
 *
 * ◆ The posture
 *   Nothing here decides behaviour from a version *number*. A version string is
 *   only ever displayed, never branched on: DSH ships nightly, and a plugin that
 *   says "0.1.7 or newer" is wrong the day a 0.1.8 renames one method. What this
 *   module does instead is make every integration point **optional and
 *   independently failable**:
 *
 *     · each call into the harness is attempted, and its outcome recorded;
 *     · a call that throws degrades that one surface, never the plugin row;
 *     · the recorded outcomes are shown to the user, so an unsupported harness
 *       says *which* piece is missing instead of silently doing nothing.
 *
 *   {@link VERIFIED_DSH_VERSIONS} is the one place a version list appears, and
 *   it is advisory only — it feeds the "已实测 / 未实测" label next to the
 *   detected version so a user on an untested build knows to look at the
 *   capability rows rather than assume the worst.
 */

/**
 * The DSH runtime versions this plugin has actually been exercised against.
 *
 * Advisory only — see the file comment. `0.1.6-alpha.1` is the generation the
 * client half was originally written for; `0.1.7-rc.2` is the generation the
 * compatibility layer was added on; `0.2.0-rc.1` is the generation that added a
 * plugin-compatibility gate the manifest has to stay on the right side of (see
 * {@link isEnforcedDshPeer}). All three were verified end to end (host routes,
 * served client bundle, live settings page).
 */
const VERIFIED_DSH_VERSIONS = ['0.1.6-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1'];

/** The package scope whose **peer** declarations a DSH runtime may enforce. */
const DSH_PEER_PREFIX = '@deepseek-ai/dsh';

/**
 * Whether a peer name is one a DSH runtime would enforce.
 *
 * DSH 0.2.0-rc.1 introduced `evaluatePluginCompatibility()`: every
 * `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*` key in a package's
 * `peerDependencies` is tested against the running runtime, and a mismatch is
 * not a warning — a **bundle** is skipped at startup (`skippedBundles`, printed
 * once per start) and a **loader row** is rewritten to `disabled: true`, unless
 * the profile carries an exact `name@version` exemption in its own
 * `compatibility.json`. Peers outside this scope — `@deepseek-ai/cordis`,
 * `react` — are ignored by that check.
 *
 * So this plugin declares no peer in this scope at all, and that is a decision
 * rather than an omission: its posture is to probe each interface at run time
 * instead of asserting a version range, so a declared range could only ever
 * *subtract* it from a profile it would otherwise have run in — silently, and
 * on exactly the unknown future runtime the probe layer exists for. A peer range
 * is a guess that fails closed; {@link COMPAT_STATUSES} in the settings page is
 * the honest answer to "does this runtime work".
 *
 * Mirrors the runtime's own test, which accepts `@deepseek-ai/dsh` exactly or
 * any `@deepseek-ai/dsh-` prefixed name. `test/compat.test.mjs` asserts the
 * manifest stays outside this scope, because the property is load-bearing.
 *
 * @param name - a `peerDependencies` key.
 * @returns whether a DSH runtime may refuse this plugin over that peer.
 */
function isEnforcedDshPeer(name) {
  return name === DSH_PEER_PREFIX || name.startsWith(`${DSH_PEER_PREFIX}-`);
}

/** Statuses a capability row can carry, worst last. */
const COMPAT_STATUSES = ['ok', 'degraded', 'missing'];

/* ── version strings ──────────────────────────────────────────────────────── */

/**
 * Split a semver-ish version into comparable parts.
 *
 * Tolerant on purpose: DSH versions in the wild include `0.1.6-alpha.1`,
 * `0.1.7-rc.2`, and plain `0.1.7`. Anything without at least a major.minor is
 * rejected rather than guessed at, because a wrong number displayed to the user
 * is worse than no number.
 *
 * @param value - the candidate version string.
 * @returns `{ major, minor, patch, prerelease, raw }`, or `null`.
 */
function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?\s*$/.exec(value);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4] === undefined ? '' : match[4],
    raw: value.trim(),
  };
}

/**
 * Whether `value` is the same as, or newer than, `floor`.
 *
 * Only used for the advisory label and for tests; no behaviour is gated on it.
 * A prerelease sorts *below* its release (`0.1.7-rc.2 < 0.1.7`), which is what
 * semver says and what a reader expects.
 *
 * @param value - the version to test.
 * @param floor - the version to compare against.
 * @returns whether `value >= floor`.
 */
function versionAtLeast(value, floor) {
  const left = parseVersion(value);
  const right = parseVersion(floor);
  if (left === null || right === null) return false;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key];
  }
  if (left.prerelease === right.prerelease) return true;
  if (left.prerelease === '') return true;
  if (right.prerelease === '') return false;
  return left.prerelease >= right.prerelease;
}

/**
 * Classify a detected DSH version for display.
 *
 * @param value - the detected version, or anything else.
 * @param verified - the advisory list; defaults to {@link VERIFIED_DSH_VERSIONS}.
 * @returns `'verified'`, `'untested'`, or `'unknown'`.
 */
function classifyVersion(value, verified) {
  const parsed = parseVersion(value);
  if (parsed === null) return 'unknown';
  const list = Array.isArray(verified) ? verified : VERIFIED_DSH_VERSIONS;
  return list.indexOf(parsed.raw) >= 0 ? 'verified' : 'untested';
}

/* ── the capability report ────────────────────────────────────────────────── */

/**
 * One row of the compatibility report.
 *
 * @param id - stable key, used as the React key and the test handle.
 * @param label - the row's title, already localized by the caller.
 * @param status - one of {@link COMPAT_STATUSES}.
 * @param detail - what was found, in the caller's words.
 * @returns the row.
 */
function compatEntry(id, label, status, detail) {
  return {
    id,
    label,
    status: COMPAT_STATUSES.indexOf(status) >= 0 ? status : 'degraded',
    detail: typeof detail === 'string' ? detail : '',
  };
}

/**
 * Fold capability rows into one verdict.
 *
 * `failed` counts only the rows that are genuinely absent, so a harness missing
 * the optional sidebar seat still reads as healthy — it is a smaller feature
 * set, not a broken plugin.
 *
 * @param entries - rows from {@link compatEntry}.
 * @returns `{ total, ok, degraded, failed, verdict }`.
 */
function summarizeCompat(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  let ok = 0;
  let degraded = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === 'ok') ok += 1;
    else if (row.status === 'missing') failed += 1;
    else degraded += 1;
  }
  return {
    total: rows.length,
    ok,
    degraded,
    failed,
    verdict: failed > 0 ? 'unsupported' : degraded > 0 ? 'partial' : 'full',
  };
}

/** Turn an unknown thrown value into a short, printable reason. */
function reasonOf(error) {
  if (error === null || error === undefined) return '未知错误';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message !== '') return error.message;
  return String(error);
}

/* ── locale: two registration overloads, one caller ───────────────────────── */

/**
 * Register this plugin's dictionaries against whichever overload the running
 * DSH has.
 *
 * DSH 0.1.6+ exposes `register(ns, { zh, en })`; the per-locale form
 * `register(ns, locale, dict)` is the older, narrower shape. Both are attempted
 * in that order — the bundled one first because it is atomic, the per-locale
 * one second because a partial failure there can be rolled back.
 *
 * @param locale - the `ctx.locale` service (or anything else).
 * @param ns - the namespace to register under.
 * @param dictionaries - `{ <localeId>: { <key>: <text> } }`.
 * @returns `{ ok, mode, dispose, error }`; `dispose` is always a function when
 *   `ok`, so the caller can register it as an effect unconditionally.
 */
function registerLocaleDictionary(locale, ns, dictionaries) {
  const none = { ok: false, mode: 'none', dispose: () => undefined, error: '' };
  if (locale === null || typeof locale !== 'object' || typeof locale.register !== 'function') {
    return { ...none, error: 'locale 服务没有 register()' };
  }
  const ids = Object.keys(dictionaries);

  let bundledError = '';
  try {
    const dispose = locale.register(ns, dictionaries);
    return {
      ok: true,
      mode: 'bundled',
      dispose: typeof dispose === 'function' ? dispose : () => undefined,
      error: '',
    };
  } catch (error) {
    bundledError = reasonOf(error);
  }

  // Per-locale fallback. A throw halfway through must not leave half the
  // dictionaries registered under a namespace this plugin will then re-register.
  const disposers = [];
  try {
    for (const id of ids) {
      const dispose = locale.register(ns, id, dictionaries[id]);
      if (typeof dispose === 'function') disposers.push(dispose);
    }
    return {
      ok: true,
      mode: 'per-locale',
      dispose: () => {
        for (const dispose of disposers) dispose();
      },
      error: '',
    };
  } catch (error) {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // A disposer that throws on rollback is not worth reporting twice.
      }
    }
    return { ...none, error: `bundled: ${bundledError}; per-locale: ${reasonOf(error)}` };
  }
}

/**
 * The translator the page renders through.
 *
 * Prefers the harness's own `bind(ns)` — it is the only version that follows a
 * live locale switch — and falls back to a translator over this plugin's own
 * dictionaries. The fallback is what keeps the settings page *readable* on a
 * harness whose locale service changed shape: it shows English (or Chinese)
 * instead of not rendering at all.
 *
 * @param locale - the `ctx.locale` service (or anything else).
 * @param ns - the namespace the dictionaries were registered under.
 * @param dictionaries - the same map handed to {@link registerLocaleDictionary}.
 * @param preferred - which dictionary the fallback should read; `'zh'` or `'en'`.
 * @returns `{ t, mode }` where `t(key, params?)` always returns a string.
 */
function createTranslator(locale, ns, dictionaries, preferred) {
  const ids = Object.keys(dictionaries);
  const wanted = typeof preferred === 'string' ? preferred.toLowerCase() : '';
  // Exact id first, then the language subtag: a harness reporting `zh-CN` or
  // `zh-Hans` must still land on the `zh` dictionary rather than silently
  // falling through to whichever dictionary happened to be declared first.
  const exact = ids.find((id) => id.toLowerCase() === wanted);
  const prefix = ids.find((id) => wanted !== '' && wanted.split('-')[0] === id.toLowerCase().split('-')[0]);
  const chosen = exact ?? prefix ?? ids[0];

  if (locale !== null && typeof locale === 'object' && typeof locale.bind === 'function') {
    try {
      const bound = locale.bind(ns);
      if (typeof bound === 'function') {
        // Probe once: a `bind` that exists but answers `undefined` for a key it
        // was just given is not a translator, and the page would render blank.
        const probe = bound('title');
        if (typeof probe === 'string' && probe !== '') return { t: bound, mode: 'bound' };
      }
    } catch {
      // Fall through to the local dictionary.
    }
  }

  const table = chosen === undefined ? {} : dictionaries[chosen];
  const t = (key) => {
    const text = typeof table === 'object' && table !== null ? table[key] : undefined;
    return typeof text === 'string' ? text : String(key);
  };
  return { t, mode: 'local' };
}

/* ── client Slots ─────────────────────────────────────────────────────────── */

/**
 * Register one client Slot surface, isolating its failure.
 *
 * The plugin occupies two **additive** seats (`settings.section` and
 * `sidebar.footer.action`), and they are independent: a harness that no longer
 * declares the sidebar seat must still get the settings page. Registering them
 * through here is what makes that true — a throw is recorded, not propagated.
 *
 * @param slots - the `ctx.slots` service (or anything else).
 * @param key - the Slot key to occupy.
 * @param declaration - the registration fields, `name` excluded (it is `key`).
 * @param component - the component to render in the seat.
 * @returns `{ ok, dispose, error }`.
 */
function registerSlotSurface(slots, key, declaration, component) {
  if (slots === null || typeof slots !== 'object') {
    return { ok: false, dispose: () => undefined, error: 'slots 服务不存在' };
  }
  if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    return { ok: false, dispose: () => undefined, error: 'slots 服务没有 inject()/register()' };
  }
  try {
    const dispose = slots.inject(key, () => slots.register({ ...declaration, name: key }, component));
    return {
      ok: true,
      dispose: typeof dispose === 'function' ? dispose : () => undefined,
      error: '',
    };
  } catch (error) {
    return { ok: false, dispose: () => undefined, error: reasonOf(error) };
  }
}

/* ── host routes ──────────────────────────────────────────────────────────── */

/**
 * Claim this plugin's route prefix, tolerating a changed registration shape.
 *
 * `register({ kind: 'prefix', path, handler })` is the shape DSH 0.1.6 and
 * 0.1.7 both take. It is called through here so that a harness which renames or
 * rejects it produces one recorded failure — the plugin's settings page then
 * says "宿主路由未注册" — instead of an exception thrown while the fiber is
 * applying, which would take the whole row down and, on some harness versions,
 * the boot with it.
 *
 * @param webServer - the `webServer` service (or anything else).
 * @param path - the prefix to claim.
 * @param handler - the `(req, res)` handler.
 * @returns `{ ok, mode, dispose, error }`.
 */
function registerPrefixRoute(webServer, path, handler) {
  const none = { ok: false, mode: 'none', dispose: () => undefined, error: '' };
  if (webServer === null || typeof webServer !== 'object' || typeof webServer.register !== 'function') {
    return { ...none, error: 'webServer 服务没有 register()' };
  }
  try {
    const dispose = webServer.register({ kind: 'prefix', path, handler });
    if (typeof dispose !== 'function') {
      // Registered, but this version hands back nothing to call on teardown.
      return { ok: true, mode: 'no-disposer', dispose: () => undefined, error: '' };
    }
    return { ok: true, mode: 'disposer', dispose, error: '' };
  } catch (error) {
    return { ...none, error: reasonOf(error) };
  }
}

// src/client.js
/*
 * Client half of `dsh-wallhaven-wallpaper` — the "壁纸 · Wallpaper" settings page
 * and the shell background it wears.
 *
 * ★ This file is the **body of the client module factory**, not a standalone ES
 *   module. `scripts/build.mjs` wraps it in DSH's `window.__ModuleLoader__`
 *   envelope and prepends `src/shared/constants.js` (with its `export` keywords
 *   stripped) — that is where `CONFIG_DEFAULTS`, `ROUTE_BASE`, `normalizeConfig`,
 *   `maskToFlags`, `flagsToMask`, `fadeColor` and friends come from, so the page
 *   and the host cannot disagree about what a valid configuration is.
 *
 *   `require` is the carrier's module resolver, so React arrives exactly the way
 *   DSH's own client modules get it — no bundler, no build-time React.
 *
 * ◆ How the background is worn
 *   The shell's own surface colours are CSS custom properties (`--dsw-alias-*`).
 *   Rather than painting over the product, this plugin reads those tokens back
 *   from the live theme and rewrites them at a lower alpha, so the product keeps
 *   choosing the colour and this plugin only chooses how much wallpaper shows
 *   through it. Nothing is replaced, so uninstalling restores the shell exactly
 *   — and every theme, including ones shipped later, keeps working, because the
 *   original value is read at runtime instead of being hard-coded here.
 */

const React = require('react');
const h = React.createElement;

/** The locale namespace this page registers its copy under. */
const NS = 'settings.wallhaven-wallpaper';

/** How long a keystroke in the query box waits before it is saved. */
const QUERY_DEBOUNCE_MS = 600;

/* ── copy ─────────────────────────────────────────────────────────────────── */

const en = {
  nav: 'Wallpaper',
  title: 'Wallhaven wallpaper',
  subtitle: 'Search wallhaven.cc and wear a result as this GUI\u2019s background. Images are fetched by the host half, so the page never needs to reach wallhaven itself.',
  loading: 'Loading\u2026',
  saveFailed: 'Could not save: {reason}',
  statusOk: 'wallhaven reachable \xB7 {ms} ms',
  statusBad: 'wallhaven unreachable: {reason}',
  statusChecking: 'Checking wallhaven\u2026',
  statusProxy: 'proxy {proxy}',
  statusProxyNone: 'direct connection',
  statusRecheck: 'Re-check',
  enabledLabel: 'Wear a wallpaper',
  enabledHint: 'Off restores the shell exactly as it was.',
  searchTitle: 'Search',
  searchPlaceholder: 'Tags, colours, @uploader, id:123, -excluded\u2026',
  searchAction: 'Search',
  searching: 'Searching\u2026',
  searchEmpty: 'No wallpapers matched. Try a broader filter or clear the tags.',
  searchFailed: 'Search failed: {reason}',
  searchHint: 'A minimum resolution keeps phone-shaped art out of a desktop wallpaper.',
  categoryLabel: 'Categories',
  purityLabel: 'Purity',
  purityNote: 'Sketchy and NSFW need a wallhaven API key. At least one has to stay on.',
  sortingLabel: 'Sort by',
  rangeLabel: 'Top range',
  atleastLabel: 'At least',
  ratioLabel: 'Ratio',
  pageLabel: '{page} / {last} \xB7 {total} wallpapers',
  pagePrev: 'Previous',
  pageNext: 'Next',
  resultsTitle: 'Results',
  resultsIdle: 'Search to see thumbnails.',
  currentTitle: 'Current background',
  currentNone: 'Nothing is worn yet. Pick a wallpaper below and choose \u201CWear this\u201D.',
  wear: 'Wear this',
  wearing: 'Wearing this',
  download: 'Download original',
  downloading: 'Downloading\u2026',
  openPage: 'Open on wallhaven',
  downloaded: 'Saved to {path}',
  downloadFailed: 'Download failed: {reason}',
  appearanceTitle: 'Appearance',
  surfaceLabel: 'Surface opacity',
  surfaceHint: '0 = the shell is glass, 1 = the wallpaper is hidden behind it.',
  blurLabel: 'Wallpaper blur',
  scrimLabel: 'Darkening',
  fitLabel: 'Scaling',
  positionLabel: 'Anchor',
  downloadDirLabel: 'Save originals to',
  downloadDirPlaceholder: '(default) {dir}',
  downloadDirHint: 'Leave empty to use the default folder.',
  accessTitle: 'Access',
  apiKeyLabel: 'wallhaven API key',
  apiKeyPlaceholder: 'optional \u2014 needed for sketchy / NSFW and saved filters',
  apiKeyHint: 'Sent to wallhaven as a header, never in a URL. Stored in this plugin\u2019s own file.',
  proxyLabel: 'Proxy',
  proxyPlaceholder: 'optional \u2014 e.g. http://127.0.0.1:7897',
  proxyHint: 'Empty reads HTTPS_PROXY from the environment, then looks for a local proxy on the usual ports. Only http/https proxies are supported.',
  pathsHint: 'Configuration: {file}',
  quickLabel: 'Shuffle a new wallpaper',
  quickHint: 'Wear a random result of the current search',
  quickBusy: 'Shuffling\u2026',
  quickFailed: 'Could not shuffle: {reason}',
  fitCover: 'Fill',
  fitContain: 'Fit',
  fitFill: 'Stretch',
  fitTile: 'Tile',
  positionCenter: 'Centre',
  positionTop: 'Top',
  positionBottom: 'Bottom',
  positionLeft: 'Left',
  positionRight: 'Right',
  sortDateAdded: 'Newest',
  sortRelevance: 'Relevance',
  sortRandom: 'Random',
  sortViews: 'Views',
  sortFavorites: 'Favourites',
  sortToplist: 'Top list',
  categoryGeneral: 'General',
  categoryAnime: 'Anime',
  categoryPeople: 'People',
  none: 'Any',
  compatTitle: 'Compatibility',
  compatHint: 'This plugin rewrites none of the shell: it occupies additive seats and calls public interfaces. These are the ones it actually found this time \u2014 after a Harness update, look here first.',
  compatDsh: 'Harness version',
  compatProfile: 'Profile',
  compatNode: 'Node',
  compatRoutes: 'Host routes',
  compatSettingsSeat: 'Settings page seat',
  compatSidebarSeat: 'Sidebar action seat',
  compatLocale: 'Copy dictionaries',
  compatTheme: 'Theme tokens',
  compatDom: 'Background layer',
  compatVerified: 'verified',
  compatUntested: 'not tested on this build',
  compatUnknownVersion: 'version not detected',
  compatVerdictFull: 'Everything this plugin needs is present.',
  compatVerdictPartial: 'Working, with some optional pieces missing.',
  compatVerdictUnsupported: 'This harness is missing something required; the host half or the page cannot work.',
  compatStatusOk: 'OK',
  compatStatusDegraded: 'Degraded',
  compatStatusMissing: 'Missing',
  compatUnknown: 'unknown',
  compatVia: 'via {mode}',
  compatFrom: 'source: {source}',
  compatHostDown: 'The host half did not answer \u2014 it may not be mounted.',
  unreachable: 'wallhaven is unreachable, so this search was skipped. Fix the connection first \u2014 see the status line above, or press Re-check.',
  useProxy: 'Use {proxy}',
  proxyFound: 'Found a working local proxy: {proxy} \xB7 {ms} ms',
  proxyNoneFound: 'No local proxy answered on the usual ports.',
  purityKeepOne: 'At least one purity has to stay on \u2014 with none selected, wallhaven returns nothing.'
};

const zh = {
  nav: '\u58C1\u7EB8',
  title: 'Wallhaven \u58C1\u7EB8',
  subtitle: '\u4ECE wallhaven.cc \u641C\u56FE\uFF0C\u5E76\u628A\u5B83\u94FA\u6210\u8FD9\u4E2A GUI \u7684\u80CC\u666F\u3002\u56FE\u7247\u7531\u5BBF\u4E3B\u7AEF\u4E0B\u8F7D\uFF0C\u9875\u9762\u672C\u8EAB\u4E0D\u9700\u8981\u80FD\u8BBF\u95EE wallhaven\u3002',
  loading: '\u52A0\u8F7D\u4E2D\u2026',
  saveFailed: '\u4FDD\u5B58\u5931\u8D25\uFF1A{reason}',
  statusOk: 'wallhaven \u53EF\u8FBE \xB7 {ms} ms',
  statusBad: '\u8FDE\u4E0D\u4E0A wallhaven\uFF1A{reason}',
  statusChecking: '\u6B63\u5728\u68C0\u6D4B wallhaven\u2026',
  statusProxy: '\u4EE3\u7406 {proxy}',
  statusProxyNone: '\u76F4\u8FDE',
  statusRecheck: '\u91CD\u65B0\u68C0\u6D4B',
  enabledLabel: '\u542F\u7528\u754C\u9762\u58C1\u7EB8',
  enabledHint: '\u5173\u6389\u540E\u754C\u9762\u4F1A\u5B8C\u5168\u6062\u590D\u539F\u6837\u3002',
  searchTitle: '\u641C\u7D22',
  searchPlaceholder: '\u6807\u7B7E\u3001\u989C\u8272\u3001@\u4F5C\u8005\u3001id:123\u3001-\u6392\u9664\u2026',
  searchAction: '\u641C\u7D22',
  searching: '\u641C\u7D22\u4E2D\u2026',
  searchEmpty: '\u6CA1\u6709\u5339\u914D\u7684\u58C1\u7EB8\u3002\u8BD5\u8BD5\u653E\u5BBD\u6761\u4EF6\uFF0C\u6216\u6E05\u7A7A\u6807\u7B7E\u3002',
  searchFailed: '\u641C\u7D22\u5931\u8D25\uFF1A{reason}',
  searchHint: '\u8BBE\u4E00\u4E2A\u6700\u4F4E\u5206\u8FA8\u7387\uFF0C\u53EF\u4EE5\u628A\u624B\u673A\u5C3A\u5BF8\u7684\u56FE\u6321\u5728\u684C\u9762\u58C1\u7EB8\u4E4B\u5916\u3002',
  categoryLabel: '\u5206\u7C7B',
  purityLabel: '\u5206\u7EA7',
  purityNote: 'Sketchy \u4E0E NSFW \u9700\u8981 wallhaven API Key\uFF1B\u4E09\u4E2A\u81F3\u5C11\u8981\u7559\u4E00\u4E2A\u3002',
  sortingLabel: '\u6392\u5E8F',
  rangeLabel: '\u699C\u5355\u533A\u95F4',
  atleastLabel: '\u6700\u4F4E\u5206\u8FA8\u7387',
  ratioLabel: '\u6BD4\u4F8B',
  pageLabel: '\u7B2C {page} / {last} \u9875 \xB7 \u5171 {total} \u5F20',
  pagePrev: '\u4E0A\u4E00\u9875',
  pageNext: '\u4E0B\u4E00\u9875',
  resultsTitle: '\u7ED3\u679C',
  resultsIdle: '\u5148\u641C\u7D22\u4E00\u6B21\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u7F29\u7565\u56FE\u3002',
  currentTitle: '\u5F53\u524D\u80CC\u666F',
  currentNone: '\u8FD8\u6CA1\u6709\u94FA\u58C1\u7EB8\u3002\u5728\u4E0B\u9762\u9009\u4E00\u5F20\uFF0C\u70B9\u300C\u8BBE\u4E3A\u80CC\u666F\u300D\u3002',
  wear: '\u8BBE\u4E3A\u80CC\u666F',
  wearing: '\u6B63\u5728\u4F7F\u7528',
  download: '\u4E0B\u8F7D\u539F\u56FE',
  downloading: '\u4E0B\u8F7D\u4E2D\u2026',
  openPage: '\u5728 wallhaven \u6253\u5F00',
  downloaded: '\u5DF2\u4FDD\u5B58\u5230 {path}',
  downloadFailed: '\u4E0B\u8F7D\u5931\u8D25\uFF1A{reason}',
  appearanceTitle: '\u5916\u89C2',
  surfaceLabel: '\u754C\u9762\u4E0D\u900F\u660E\u5EA6',
  surfaceHint: '0 = \u754C\u9762\u5168\u900F\uFF0C1 = \u58C1\u7EB8\u88AB\u5B8C\u5168\u76D6\u4F4F\u3002',
  blurLabel: '\u58C1\u7EB8\u6A21\u7CCA',
  scrimLabel: '\u53D8\u6697\u906E\u7F69',
  fitLabel: '\u586B\u5145\u65B9\u5F0F',
  positionLabel: '\u5BF9\u9F50',
  downloadDirLabel: '\u539F\u56FE\u4FDD\u5B58\u5230',
  downloadDirPlaceholder: '\uFF08\u9ED8\u8BA4\uFF09{dir}',
  downloadDirHint: '\u7559\u7A7A\u5C31\u7528\u9ED8\u8BA4\u76EE\u5F55\u3002',
  accessTitle: '\u8BBF\u95EE',
  apiKeyLabel: 'wallhaven API Key',
  apiKeyPlaceholder: '\u53EF\u9009 \u2014\u2014 sketchy / NSFW \u4E0E\u4E2A\u4EBA\u7B5B\u9009\u9700\u8981',
  apiKeyHint: '\u4EE5\u8BF7\u6C42\u5934\u53D1\u7ED9 wallhaven\uFF0C\u4E0D\u4F1A\u51FA\u73B0\u5728 URL \u91CC\uFF1B\u5B58\u5728\u672C\u63D2\u4EF6\u81EA\u5DF1\u7684\u914D\u7F6E\u6587\u4EF6\u4E2D\u3002',
  proxyLabel: '\u4EE3\u7406',
  proxyPlaceholder: '\u53EF\u9009 \u2014\u2014 \u4F8B\u5982 http://127.0.0.1:7897',
  proxyHint: '\u7559\u7A7A\u65F6\u5148\u8BFB\u73AF\u5883\u53D8\u91CF HTTPS_PROXY\uFF0C\u518D\u81EA\u52A8\u63A2\u6D4B\u672C\u673A\u5E38\u89C1\u4EE3\u7406\u7AEF\u53E3\u3002\u4EC5\u652F\u6301 http/https \u4EE3\u7406\u3002',
  pathsHint: '\u914D\u7F6E\u6587\u4EF6\uFF1A{file}',
  quickLabel: '\u6362\u4E00\u5F20',
  quickHint: '\u4ECE\u5F53\u524D\u641C\u7D22\u6761\u4EF6\u91CC\u968F\u673A\u6362\u4E00\u5F20\u58C1\u7EB8',
  quickBusy: '\u6362\u56FE\u4E2D\u2026',
  quickFailed: '\u6362\u56FE\u5931\u8D25\uFF1A{reason}',
  fitCover: '\u94FA\u6EE1',
  fitContain: '\u5B8C\u6574',
  fitFill: '\u62C9\u4F38',
  fitTile: '\u5E73\u94FA',
  positionCenter: '\u5C45\u4E2D',
  positionTop: '\u9876\u90E8',
  positionBottom: '\u5E95\u90E8',
  positionLeft: '\u5DE6\u4FA7',
  positionRight: '\u53F3\u4FA7',
  sortDateAdded: '\u6700\u65B0',
  sortRelevance: '\u76F8\u5173\u5EA6',
  sortRandom: '\u968F\u673A',
  sortViews: '\u6D4F\u89C8\u91CF',
  sortFavorites: '\u6536\u85CF\u91CF',
  sortToplist: '\u699C\u5355',
  categoryGeneral: '\u7EFC\u5408',
  categoryAnime: '\u52A8\u6F2B',
  categoryPeople: '\u4EBA\u7269',
  none: '\u4E0D\u9650',
  compatTitle: '\u517C\u5BB9\u6027',
  compatHint: '\u672C\u63D2\u4EF6\u4E0D\u6539\u5199\u5B98\u65B9\u4EE3\u7801\uFF0C\u53EA\u5360\u7528\u589E\u91CF\u5E2D\u4F4D\u5E76\u8C03\u7528\u516C\u5F00\u63A5\u53E3\u3002\u4E0B\u9762\u662F\u5B83\u8FD9\u6B21\u5B9E\u9645\u627E\u5230\u7684\u63A5\u53E3\u2014\u2014\u6362\u4E86 Harness \u7248\u672C\u4E4B\u540E\uFF0C\u5148\u770B\u8FD9\u91CC\u3002',
  compatDsh: 'Harness \u7248\u672C',
  compatProfile: '\u914D\u7F6E\u6863\u6848',
  compatNode: 'Node',
  compatRoutes: '\u5BBF\u4E3B\u8DEF\u7531',
  compatSettingsSeat: '\u8BBE\u7F6E\u9875\u5E2D\u4F4D',
  compatSidebarSeat: '\u4FA7\u8FB9\u680F\u5E2D\u4F4D',
  compatLocale: '\u6587\u6848\u5B57\u5178',
  compatTheme: '\u4E3B\u9898 token',
  compatDom: '\u80CC\u666F\u56FE\u5C42',
  compatVerified: '\u5DF2\u5B9E\u6D4B',
  compatUntested: '\u672A\u5728\u6B64\u7248\u672C\u5B9E\u6D4B',
  compatUnknownVersion: '\u672A\u8BC6\u522B\u51FA\u7248\u672C',
  compatVerdictFull: '\u672C\u63D2\u4EF6\u9700\u8981\u7684\u63A5\u53E3\u90FD\u5728\u3002',
  compatVerdictPartial: '\u53EF\u7528\uFF0C\u4F46\u6709\u53EF\u9009\u63A5\u53E3\u7F3A\u5931\uFF08\u529F\u80FD\u4F1A\u5C11\u4E00\u5757\uFF09\u3002',
  compatVerdictUnsupported: '\u6B64 Harness \u7F3A\u5C11\u5FC5\u9700\u63A5\u53E3\uFF0C\u5BBF\u4E3B\u534A\u6216\u9875\u9762\u65E0\u6CD5\u5DE5\u4F5C\u3002',
  compatStatusOk: '\u6B63\u5E38',
  compatStatusDegraded: '\u964D\u7EA7',
  compatStatusMissing: '\u7F3A\u5931',
  compatUnknown: '\u672A\u77E5',
  compatVia: '\u65B9\u5F0F\uFF1A{mode}',
  compatFrom: '\u6765\u6E90\uFF1A{source}',
  compatHostDown: '\u5BBF\u4E3B\u7AEF\u6CA1\u6709\u5E94\u7B54\u2014\u2014\u5BBF\u4E3B\u534A\u53EF\u80FD\u672A\u6302\u8F7D\u3002',
  unreachable: '\u8FDE\u4E0D\u4E0A wallhaven\uFF0C\u8FD9\u6B21\u641C\u7D22\u5DF2\u8DF3\u8FC7\u3002\u5148\u89E3\u51B3\u8FDE\u901A\u6027\u2014\u2014\u770B\u4E0A\u9762\u7684\u72B6\u6001\u884C\uFF0C\u6216\u70B9\u300C\u91CD\u65B0\u68C0\u6D4B\u300D\u3002',
  useProxy: '\u4F7F\u7528 {proxy}',
  proxyFound: '\u68C0\u6D4B\u5230\u672C\u673A\u4EE3\u7406\u53EF\u7528\uFF1A{proxy} \u00B7 {ms} ms',
  proxyNoneFound: '\u672C\u673A\u5E38\u89C1\u4EE3\u7406\u7AEF\u53E3\u90FD\u6CA1\u6709\u5E94\u7B54\u3002',
  purityKeepOne: '\u5206\u7EA7\u81F3\u5C11\u8981\u4FDD\u7559\u4E00\u4E2A\u2014\u2014\u4E09\u4E2A\u90FD\u4E0D\u9009\uFF0Cwallhaven \u4F1A\u8FD4\u56DE\u7A7A\u7ED3\u679C\u3002'
};

/** `{placeholder}` interpolation — the dictionaries above are the only inputs. */
function translate(t, key, params) {
  const template = t(key, params);
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/* ── talking to the host half ─────────────────────────────────────────────── */

/** Build one of this plugin's host URLs. */
function route(path, params) {
  const query = params === undefined ? '' : `?${params.toString()}`;
  return `${ROUTE_BASE}${path}${query}`;
}

/** The host route that streams one wallhaven image. */
function imageUrl(src, cache) {
  const params = new URLSearchParams({ src });
  if (cache === true) params.set('cache', '1');
  return route('/image', params);
}

/** GET one JSON route, resolving to `null` instead of throwing. */
async function getJson(url) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    return await response.json();
  } catch {
    return null;
  }
}

/** POST one JSON route, resolving to `null` instead of throwing. */
async function postJson(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await response.json();
  } catch {
    return null;
  }
}

/* ── the configuration store both plugin surfaces share ───────────────────── */

/**
 * A minimal observable holding the one configuration the page and the sidebar
 * action both read, so a change made in one is visible in the other without a
 * refetch.
 */
function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get() {
      return value;
    },
    /** Adopt a configuration the host just confirmed. */
    adopt(next) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Re-render the calling component whenever the store changes. */
function useStoreValue(store) {
  const [value, setValue] = React.useState(store.get());
  React.useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
  return value;
}

/* ── wearing the wallpaper ────────────────────────────────────────────────── */

/**
 * The surface tokens the wallpaper shows through, and how much more opaque each
 * one is than the app canvas.
 *
 * Raised surfaces (cards, nested panels) get a little more body than the canvas
 * so they stay distinguishable from it once both are translucent; overlays and
 * popovers are deliberately untouched, because a menu over a photograph is a
 * menu nobody can read.
 */
const SURFACE_TOKENS = [
  { name: '--dsw-alias-bg-base', lift: 0 },
  { name: '--dsw-specific-sidebar-fill', lift: 0 },
  { name: '--dsw-alias-bg-layer-1', lift: 0.18 },
  { name: '--dsw-alias-bg-layer-2', lift: 0.18 },
];

/** Geometry and stacking of the wallpaper layer; values arrive as properties. */
const LAYER_CSS = [
  '[data-dsh-wh-layer]{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}',
  /* No `will-change: filter`, and no permanent bleed: with the default blur of
     0 both are pure cost — a promoted compositing layer and an image box ~20%
     larger than the viewport — for an element that is already the size of the
     screen. The bleed is applied only while a blur actually needs it. */
  '[data-dsh-wh-image]{position:absolute;inset:0;background-repeat:no-repeat;background-position:center center;background-size:cover}',
  '[data-dsh-wh-image][data-fit="contain"]{background-size:contain}',
  '[data-dsh-wh-image][data-fit="fill"]{background-size:100% 100%}',
  '[data-dsh-wh-image][data-fit="tile"]{background-size:auto;background-repeat:repeat}',
  '[data-dsh-wh-scrim]{position:absolute;inset:0}',
].join('');

/**
 * The primary-button fill when the theme does not define one.
 *
 * Named because two places must agree on it: the button's `background` fallback
 * and the foreground {@link readableForeground} derives from it.
 */
const BRAND_FALLBACK = '#4d6bfe';

/**
 * The custom property carrying the primary button's text colour.
 *
 * Emitted by {@link createBackground} into the dynamic stylesheet and read by
 * `S.buttonPrimary` and `S.chipOn`. Its value is
 * `var(--dsw-alias-label-primary-inverted, <derived>)`, so the theme's own token
 * wins whenever it exists — see {@link readableForeground} for why the fallback
 * has to be derived rather than hard-coded.
 */
const ON_BRAND_VAR = '--dsh-wh-on-brand';

/**
 * Where {@link ON_BRAND_VAR} is declared.
 *
 * On `body` as well as the root, for the same reason
 * {@link surfaceOverrideSelector} exists: DSH defines its alias tokens on
 * `body`, so a `var()` reference to one of them only resolves to the live value
 * when it is substituted on `body` itself. Declaring it there is what lets CSS —
 * rather than a JavaScript snapshot — answer the question at paint time.
 */
const ON_BRAND_SELECTOR = 'html:root, html:root body';

/**
 * The wallpaper layer and the token rewrites that let it show through.
 *
 * Deliberately not a React component: the background must stay worn while the
 * settings panel is closed, so it lives for as long as the plugin does.
 *
 * @returns `{ sync, refresh, dispose }`.
 */
function createBackground() {
  let layer = null;
  let imageEl = null;
  let scrimEl = null;
  let staticStyle = null;
  let dynamicStyle = null;
  /** The one-shot `DOMContentLoaded` retry, while the document has no body. */
  let bodyWaiter = null;
  /** Watches the palette attribute, which is the only reliable "it changed" signal. */
  let paletteObserver = null;
  /** The last configuration handed to `sync`, for theme-driven repaints. */
  let lastConfig = CONFIG_DEFAULTS;

  /** The element the wallpaper layer hangs off, or `null` before `<body>`. */
  function bodyOrNull() {
    const body = document.body;
    return body === null || body === undefined ? null : body;
  }

  /** Where `<style>` elements go: `<head>`, or the root if there is no head. */
  function styleHost() {
    return document.head ?? document.documentElement;
  }

  /**
   * Create the two style elements on first use.
   *
   * Both are created together and eagerly, because the dynamic sheet always
   * carries the primary-button colour — the settings page needs that whether or
   * not a wallpaper is worn.
   */
  function ensureStyles() {
    if (staticStyle === null) {
      staticStyle = document.createElement('style');
      staticStyle.setAttribute('data-plugin-css', 'dsh-wallhaven-wallpaper');
      staticStyle.textContent = LAYER_CSS;
      styleHost().appendChild(staticStyle);
    }
    if (dynamicStyle === null) {
      dynamicStyle = document.createElement('style');
      dynamicStyle.setAttribute('data-plugin-css', 'dsh-wallhaven-wallpaper-dynamic');
      styleHost().appendChild(dynamicStyle);
    }
  }

  /**
   * Mount the wallpaper layer.
   *
   * @returns whether the layer is mounted. `false` means the document has no
   *   `<body>` yet, which is a harness that materializes client modules during
   *   parsing rather than after it — recoverable, not fatal.
   */
  function ensureLayer() {
    if (layer !== null) return true;

    const body = bodyOrNull();
    if (body === null) return false;

    layer = document.createElement('div');
    layer.setAttribute('data-dsh-wh-layer', '');
    layer.setAttribute('aria-hidden', 'true');
    imageEl = document.createElement('div');
    imageEl.setAttribute('data-dsh-wh-image', '');
    scrimEl = document.createElement('div');
    scrimEl.setAttribute('data-dsh-wh-scrim', '');
    layer.appendChild(imageEl);
    layer.appendChild(scrimEl);
    // First child, so it precedes every piece of shell markup in paint order
    // as well as in the DOM.
    body.insertBefore(layer, body.firstChild);
    return true;
  }

  /**
   * Retry once the document finishes parsing.
   *
   * Registered at most once, and removed by {@link dispose}, so a plugin that is
   * unloaded before the body appears does not leave a listener behind.
   */
  function deferUntilBody() {
    if (bodyWaiter !== null) return;
    bodyWaiter = () => {
      bodyWaiter = null;
      sync(lastConfig);
    };
    document.addEventListener('DOMContentLoaded', bodyWaiter, { once: true });
  }

  /**
   * Re-read the theme whenever the palette attribute actually changes.
   *
   * ◆ Why `theme/change` is not enough
   *   The event fires *before* the shell has put `data-ds-dark-theme` on `body`.
   *   Reading the tokens in the handler therefore returns the palette that is on
   *   its way out, and — because the override selector is chosen from the same
   *   stale reading — the values get written under the *other* palette's
   *   selector. That is not a cosmetic lag: in light mode the override lands on
   *   `body[data-ds-dark-theme]`, which does not match, so the canvas token keeps
   *   the theme's opaque value and **the wallpaper never shows through at all**.
   *   Measured on DSH 0.1.7-rc.2, every switch was exactly one palette behind.
   *
   *   Observing the attribute is the fix, because the attribute *is* the thing
   *   the reading depends on: a mutation callback runs after the change, so the
   *   values and the selector are always derived from the palette that is
   *   actually in force. `subtree` is what makes it work before `<body>` exists;
   *   `attributeFilter` keeps it to the one attribute, so nothing else in the
   *   shell can wake it.
   */
  function watchPalette() {
    if (paletteObserver !== null || typeof MutationObserver !== 'function') return;
    const root = document.documentElement;
    if (root === null || root === undefined) return;
    paletteObserver = new MutationObserver(() => sync(lastConfig));
    paletteObserver.observe(root, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme'],
      subtree: true,
    });
  }

  /**
   * Read the live surface colours, with this plugin's own overrides removed.
   *
   * The removal is the whole trick: CSS custom properties are inherited, so a
   * naive read would return this plugin's previous values and the alpha would
   * compound on every update until the shell was invisible.
   *
   * Also reads the brand fill in the same pass, because a second
   * `getComputedStyle` costs another style recalculation for a value that is
   * always wanted alongside these.
   *
   * @returns `{ tokens, base, brand }` — one entry per {@link SURFACE_TOKENS}
   *   entry, the canvas colour left unfaded, and the primary-button fill. Any of
   *   them may be `''` when the theme does not define that token.
   */
  function readSurfaces() {
    const previous = dynamicStyle === null ? null : dynamicStyle.textContent;
    if (dynamicStyle !== null) dynamicStyle.textContent = '';
    const computed = getComputedStyle(bodyOrNull() ?? document.documentElement);
    const tokens = SURFACE_TOKENS.map((token) => ({
      name: token.name,
      lift: token.lift,
      value: computed.getPropertyValue(token.name).trim(),
    }));
    const base = computed.getPropertyValue('--dsw-alias-bg-base').trim();
    const brand = computed.getPropertyValue('--dsw-alias-brand-primary').trim();
    if (dynamicStyle !== null) dynamicStyle.textContent = previous;
    return { tokens, base, brand };
  }

  /**
   * The backstop colour for the primary button's text.
   *
   * ◆ Why this is only a backstop
   *   The rule emitted by {@link stylesFor} reads
   *   `var(--dsw-alias-label-primary-inverted, <this>)` — so on every harness
   *   that defines the token, **CSS** resolves it, live, at paint time. That is
   *   the whole point: a JS snapshot of a theme token is taken at one instant
   *   and goes stale the moment the palette flips, and `theme/change` is not a
   *   guarantee that the new palette is already on `body` when it fires. The
   *   first version of this code set the property from JS and produced white
   *   text on DSH's near-white dark-mode brand fill — 1.05:1, invisible.
   *
   *   This value is therefore only reached by a theme that does not define the
   *   token at all, where any readable answer beats none.
   *
   * @param surfaces - a {@link readSurfaces} result.
   * @returns a CSS colour.
   */
  function onBrandFallback(surfaces) {
    const fill = surfaces.brand === '' ? BRAND_FALLBACK : surfaces.brand;
    return readableForeground(fill, '');
  }

  /**
   * Build the stylesheet text for one configuration.
   *
   * @param config - the current configuration.
   * @param surfaces - a {@link readSurfaces} result.
   * @param wearing - whether the wallpaper layer is mounted.
   * @returns the CSS text.
   */
  function stylesFor(config, surfaces, wearing) {
    // Always emitted, worn or not: the settings page draws primary buttons
    // either way, and this rule is inert for every element that does not read
    // the property.
    const rules = [
      `${ON_BRAND_SELECTOR}{${ON_BRAND_VAR}:var(--dsw-alias-label-primary-inverted, ${onBrandFallback(surfaces)})}`,
    ];

    if (!wearing) return rules.join('\n');

    const alpha = config.surfaceOpacity;
    const declarations = [];
    for (const token of surfaces.tokens) {
      if (token.value === '') continue;
      const faded = fadeColor(token.value, Math.min(1, alpha + token.lift));
      if (faded !== null) declarations.push(`${token.name}:${faded}`);
    }

    // The canvas gets its own opaque background so that `body`'s background
    // stops being propagated to the canvas and paints as a real (translucent)
    // surface above the wallpaper layer instead of underneath it.
    const opaqueBase = surfaces.base === '' ? '#ffffff' : surfaces.base;
    const isDark = (bodyOrNull() ?? document.documentElement).hasAttribute('data-ds-dark-theme');
    const selector = surfaceOverrideSelector(isDark);

    const position = config.position === 'center' ? 'center center' : config.position;
    const scrim = Math.max(0, Math.min(0.9, config.scrim));
    // A blur samples past the edge it blurs, so the image is grown just enough
    // to keep the soft edge off screen — and not one pixel more when there is
    // no blur to hide.
    const bleed = config.blur > 0 ? Math.ceil(config.blur * 3) + 8 : 0;

    rules.push(`html{background-color:${opaqueBase}}`);
    if (declarations.length > 0) rules.push(`${selector}{${declarations.join(';')}}`);
    rules.push(`[data-dsh-wh-image]{inset:calc(-1 * ${String(bleed)}px);background-position:${position};filter:blur(${String(config.blur)}px)}`);
    rules.push(`[data-dsh-wh-scrim]{background:rgba(0,0,0,${scrim.toFixed(3)})}`);
    return rules.join('\n');
  }

  /** Remove the wallpaper layer, keeping the style elements. */
  function clear() {
    if (layer !== null) {
      layer.remove();
      layer = null;
      imageEl = null;
      scrimEl = null;
    }
  }

  /** Wear (or stop wearing) the wallpaper described by `config`. */
  function sync(config) {
    lastConfig = config;
    const wallpaper = config.wallpaper;
    const wearing = config.enabled === true && wallpaper !== null;

    ensureStyles();
    watchPalette();
    const surfaces = readSurfaces();

    if (!wearing) {
      clear();
      dynamicStyle.textContent = stylesFor(config, surfaces, false);
      return;
    }
    if (!ensureLayer()) {
      // No `<body>` yet. The button colour is still worth publishing, and the
      // layer is mounted by the retry.
      dynamicStyle.textContent = stylesFor(config, surfaces, false);
      deferUntilBody();
      return;
    }
    // `full` is the original; the browser caches it immutably, so switching
    // back to a wallpaper you have already worn costs nothing.
    imageEl.style.backgroundImage = `url("${imageUrl(wallpaper.full, false)}")`;
    imageEl.setAttribute('data-fit', config.fit);
    dynamicStyle.textContent = stylesFor(config, surfaces, true);
  }

  return {
    /** Wear, or stop wearing, the wallpaper described by `config`. */
    sync,

    /** Repaint after the theme changed underneath us. */
    refresh() {
      sync(lastConfig);
    },

    /** Give the document back exactly as it was found. */
    dispose() {
      if (bodyWaiter !== null) {
        document.removeEventListener('DOMContentLoaded', bodyWaiter);
        bodyWaiter = null;
      }
      if (paletteObserver !== null) {
        paletteObserver.disconnect();
        paletteObserver = null;
      }
      clear();
      if (staticStyle !== null) {
        staticStyle.remove();
        staticStyle = null;
      }
      if (dynamicStyle !== null) {
        dynamicStyle.remove();
        dynamicStyle = null;
      }
    },
  };
}

/* ── small presentational pieces ──────────────────────────────────────────── */

const S = {
  page: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0 20px' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  title: { margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  subtitle: { margin: '3px 0 0', fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' },
  section: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 },
  legend: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: 'var(--dsw-alias-label-tertiary)',
    borderTop: '1px solid var(--dsw-alias-border-l1)',
    paddingTop: 10,
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 76 },
  hint: { margin: 0, fontSize: 10, lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary)' },
  note: { margin: 0, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
  error: { margin: 0, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-state-error-primary, #d33)' },
  input: {
    height: 26,
    padding: '0 8px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    background: 'var(--dsw-alias-bg-layer-1, #fff)',
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'inherit',
    fontSize: 12,
    minWidth: 0,
  },
  button: {
    height: 26,
    padding: '0 10px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    fontFamily: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  buttonPrimary: {
    height: 26,
    padding: '0 12px',
    border: '1px solid transparent',
    borderRadius: 6,
    background: `var(--dsw-alias-brand-primary, ${BRAND_FALLBACK})`,
    /* Not a constant. DSH's brand primary is a neutral high-contrast fill —
       near black on the light palette, near white on the dark one — so the text
       on it has to invert with it. The paired token that normally does that,
       `--dsw-alias-label-primary-inverted`, is undocumented and can be absent
       from a theme, so `createBackground` derives this property from the live
       pair and re-derives it on every theme change. */
    color: `var(${ON_BRAND_VAR}, #fff)`,
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  chip: {
    height: 24,
    padding: '0 10px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    fontFamily: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
  },
  chipOn: {
    height: 24,
    padding: '0 10px',
    border: `1px solid var(--dsw-alias-brand-primary, ${BRAND_FALLBACK})`,
    borderRadius: 6,
    background: `var(--dsw-alias-brand-primary, ${BRAND_FALLBACK})`,
    color: `var(${ON_BRAND_VAR}, #fff)`,
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
    gap: 8,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 0,
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-1, #fff)',
    overflow: 'hidden',
    cursor: 'pointer',
    textAlign: 'start',
    color: 'inherit',
    font: 'inherit',
  },
  cardOn: { borderColor: 'var(--dsw-alias-brand-primary, #4d6bfe)' },
  thumb: { display: 'block', width: '100%', height: 78, objectFit: 'cover', background: 'var(--dsw-alias-bg-layer-2, #eee)' },
  thumbMeta: { padding: '0 6px 6px', fontSize: 10, lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary)' },
  preview: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    padding: 10,
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 10,
    background: 'var(--dsw-alias-bg-layer-1, #fff)',
  },
  previewImage: { width: 160, height: 90, objectFit: 'cover', borderRadius: 6, flexShrink: 0, background: 'var(--dsw-alias-bg-layer-2, #eee)' },
  swatches: { display: 'flex', gap: 3, marginTop: 2 },
  swatch: { width: 10, height: 10, borderRadius: 2, border: '1px solid var(--dsw-alias-border-l1)' },
  compatRows: { display: 'flex', flexDirection: 'column', gap: 3 },
  compatRow: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, lineHeight: '16px' },
  compatName: { flex: '0 0 118px', color: 'var(--dsw-alias-label-secondary)' },
  compatDot: { flex: '0 0 auto', width: 7, height: 7, borderRadius: '50%', alignSelf: 'center' },
  compatDetail: { flex: '1 1 auto', minWidth: 0, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
  compatGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(184px, 1fr))', gap: 6 },
  compatCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    padding: '6px 8px',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: 6,
    minWidth: 0,
  },
  compatKey: { fontSize: 10, lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary)' },
  compatValue: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' },
};

/** Status → colour, for the dot and the verdict line. */
const COMPAT_COLOR = {
  ok: 'var(--dsw-alias-state-success-primary, #22c55e)',
  degraded: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  missing: 'var(--dsw-alias-state-error-primary, #d33)',
};

/** Verdict → copy key. */
const COMPAT_VERDICT_KEY = {
  full: 'compatVerdictFull',
  partial: 'compatVerdictPartial',
  unsupported: 'compatVerdictUnsupported',
};

/**
 * Which language this page should read in when it has to translate locally.
 *
 * Only consulted by the {@link createTranslator} fallback — a harness whose
 * locale service works never reaches it. `navigator.language` is the second
 * signal because it exists independently of DSH, so the fallback still picks a
 * sensible language on a harness that renamed or removed the locale service.
 *
 * @param locale - the `ctx.locale` service, if any.
 * @returns a locale id such as `zh`, `zh-CN`, or `en`.
 */
function preferredLocale(locale) {
  try {
    const snapshot = typeof locale?.getLocale === 'function' ? locale.getLocale() : null;
    for (const key of ['locale', 'id', 'current', 'language']) {
      const value = snapshot === null || snapshot === undefined ? undefined : snapshot[key];
      if (typeof value === 'string' && value !== '') return value;
    }
  } catch {
    // Fall through to the browser's own answer.
  }
  const language = typeof navigator === 'object' && navigator !== null ? navigator.language : '';
  return typeof language === 'string' && language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * What the live document can tell us about the theme right now.
 *
 * A presence probe, not a value probe: it answers "does this harness still
 * define the tokens the wallpaper shows through", which is the question that
 * changes across DSH versions. Values are read for real by
 * {@link createBackground} when it paints.
 *
 * @returns `{ surfaces, total, brand, dark, body }`.
 */
function probeTheme() {
  const root = document.body ?? document.documentElement;
  let computed = null;
  try {
    computed = getComputedStyle(root);
  } catch {
    computed = null;
  }
  const read = (name) => (computed === null ? '' : computed.getPropertyValue(name).trim());
  return {
    surfaces: SURFACE_TOKENS.filter((token) => read(token.name) !== '').length,
    total: SURFACE_TOKENS.length,
    brand: read('--dsw-alias-brand-primary') !== '',
    dark: root !== null && root !== undefined && root.hasAttribute('data-ds-dark-theme'),
    body: document.body !== null && document.body !== undefined,
  };
}

/**
 * The compatibility section: which DSH is running, and what it accepted.
 *
 * @param props - `{ t, compat }`, where `compat` is the live state recorded by
 *   `apply()` and re-read through the store on every update.
 */
function CompatSection(props) {
  const t = props.t;
  const state = useStoreValue(props.compat ?? EMPTY_COMPAT);

  const host = state.host;
  const rows = [];

  rows.push(compatEntry(
    'routes',
    t('compatRoutes'),
    host === null ? 'missing' : host.routes.ok === true ? 'ok' : 'missing',
    host === null
      ? t('compatHostDown')
      : host.routes.ok === true
        ? translate(t, 'compatVia', { mode: host.routes.mode })
        : host.routes.error,
  ));
  rows.push(compatEntry('settings', t('compatSettingsSeat'), state.settings.status, state.settings.detail));
  rows.push(compatEntry('sidebar', t('compatSidebarSeat'), state.sidebar.status, state.sidebar.detail));
  rows.push(compatEntry('locale', t('compatLocale'), state.locale.status, state.locale.detail));

  const theme = probeTheme();
  rows.push(compatEntry(
    'theme',
    t('compatTheme'),
    theme.surfaces === theme.total ? 'ok' : theme.surfaces > 0 ? 'degraded' : 'missing',
    `${String(theme.surfaces)} / ${String(theme.total)} · ${theme.dark ? 'dark' : 'light'}${theme.brand ? ' · brand' : ''}`,
  ));
  rows.push(compatEntry(
    'dom',
    t('compatDom'),
    theme.body ? 'ok' : 'degraded',
    theme.body ? 'body' : 'body 尚未出现',
  ));

  const summary = summarizeCompat(rows);
  const versionLabel = host === null || host.dshVersion === ''
    ? t('compatUnknownVersion')
    : host.dshVersionStatus === 'verified'
      ? t('compatVerified')
      : t('compatUntested');

  const cells = host === null
    ? []
    : [
      { key: 'compatDsh', value: `${host.dshVersion === '' ? t('compatUnknown') : host.dshVersion} · ${versionLabel}` },
      { key: 'compatProfile', value: host.profile === '' ? t('compatUnknown') : host.profile },
      { key: 'compatNode', value: `${host.node === '' ? t('compatUnknown') : host.node} · ${host.platform}` },
    ];

  return h('div', { style: S.section },
    h('div', { style: S.legend }, t('compatTitle')),
    h('p', { style: S.hint }, t('compatHint')),
    cells.length === 0
      ? null
      : h('div', { style: S.compatGrid }, cells.map((cell) => h('div', { key: cell.key, style: S.compatCell },
        h('span', { style: S.compatKey }, t(cell.key)),
        h('span', { style: S.compatValue }, cell.value)))),
    h('p', { style: { ...S.hint, color: COMPAT_COLOR[summary.verdict === 'full' ? 'ok' : summary.verdict === 'partial' ? 'degraded' : 'missing'] } },
      t(COMPAT_VERDICT_KEY[summary.verdict])),
    h('div', { style: S.compatRows }, rows.map((row) => h('div', { key: row.id, style: S.compatRow },
      h('span', { style: S.compatName }, row.label),
      h('span', { style: { ...S.compatDot, background: COMPAT_COLOR[row.status] } }),
      h('span', { style: S.compatDetail }, row.detail === '' ? t(`compatStatus${row.status.charAt(0).toUpperCase()}${row.status.slice(1)}`) : row.detail)))),
    host === null || host.dshVersionSource === 'unknown'
      ? null
      : h('p', { style: S.hint }, translate(t, 'compatFrom', { source: host.dshVersionSource })));
}

/** A labelled control row. */
function Field(props) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
    h('div', { style: S.row },
      props.label === undefined ? null : h('span', { style: S.label }, props.label),
      props.children),
    props.hint === undefined ? null : h('p', { style: S.hint }, props.hint));
}

/** An on/off switch drawn as a real checkbox so keyboards work. */
function Toggle(props) {
  return h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--dsw-alias-label-primary)' } },
    h('input', {
      type: 'checkbox',
      checked: props.checked,
      disabled: props.disabled === true,
      onChange: (event) => props.onChange(event.target.checked),
    }),
    props.label);
}

/** One select whose options are `{value, label}` pairs. */
function Picker(props) {
  return h('select', {
    style: { ...S.input, cursor: 'pointer' },
    value: props.value,
    disabled: props.disabled === true,
    onChange: (event) => props.onChange(event.target.value),
  }, props.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)));
}

/** A row of mutually exclusive chips. */
function ChipRow(props) {
  return h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
    props.options.map((option) => h('button', {
      key: option.value,
      type: 'button',
      style: props.value === option.value ? S.chipOn : S.chip,
      onClick: () => props.onChange(option.value),
    }, option.label)));
}

/** A slider with its current value spelled out. */
function Slider(props) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 190px', minWidth: 150 } },
    h('input', {
      type: 'range',
      style: { flex: '1 1 auto', minWidth: 90 },
      min: props.min,
      max: props.max,
      step: props.step,
      value: props.value,
      onChange: (event) => props.onChange(Number(event.target.value)),
    }),
    h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'end' } }, props.display));
}

/** Human-readable byte count. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '\u2014';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── the settings page ────────────────────────────────────────────────────── */

/**
 * The "壁纸 · Wallpaper" settings page.
 *
 * @param props - the slot's composed props; `t` arrives through the section's
 *   `inject` share, `store` and `background` through the plugin closure.
 */
function WallhavenSection(props) {
  const t = props.t;
  const store = props.store;
  const config = useStoreValue(store);

  const [status, setStatus] = React.useState(null);
  const [probing, setProbing] = React.useState(false);
  const [results, setResults] = React.useState(null);
  const [page, setPage] = React.useState(1);
  const [seed, setSeed] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [note, setNote] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [queryDraft, setQueryDraft] = React.useState(config.query);

  // The saved query is the truth, but only once it has settled: adopting it on
  // every change is what lets the sidebar action and this page agree, while
  // typing (which changes only the draft) is never interrupted.
  React.useEffect(() => {
    setQueryDraft(config.query);
  }, [config.query]);

  /**
   * Persist a patch and adopt whatever the host confirms.
   *
   * The host is the validator, so adopting its answer (rather than the local
   * guess) is what keeps the page from displaying a value that was rejected.
   */
  const save = React.useCallback(async (patch, options) => {
    const response = await postJson(route('/config'), { patch });
    if (response === null || response.ok !== true) {
      setError(translate(t, 'saveFailed', { reason: response?.reason ?? 'no response' }));
      return false;
    }
    store.adopt(response.config);
    if (options?.quiet !== true) setError(null);
    return true;
  }, [store, t]);

  /**
   * The last connectivity result, as a ref.
   *
   * A ref rather than state because {@link search} needs the value at the moment
   * it runs, not the one captured when its `useCallback` was built — and a stale
   * "reachable" is exactly the thing that would let a search hang for twenty
   * seconds again.
   */
  const probeRef = React.useRef(null);

  /** Test the connection, and look for a local proxy when none is configured. */
  const probe = React.useCallback(async () => {
    setProbing(true);
    const response = await getJson(route('/status', new URLSearchParams({ diagnose: '1' })));
    setProbing(false);
    if (response !== null && response.ok === true) {
      setStatus(response);
      probeRef.current = response.probe ?? null;
    }
  }, []);

  React.useEffect(() => {
    probe();
    getJson(route('/status')).then((response) => {
      if (response !== null && response.ok === true) setStatus((current) => current ?? response);
    });
  }, [probe]);

  /**
   * Whether a search is worth attempting.
   *
   * A search against an unreachable host does not fail fast: it waits out the
   * full request budget and then reports the same thing the status line already
   * said. Testing first turns that twenty-second dead end into an immediate,
   * actionable answer — and it is also the moment a discovered local proxy gets
   * offered, because the only reason to look for one is that nothing works.
   *
   * @returns whether wallhaven answered.
   */
  const ensureReachable = React.useCallback(async () => {
    const known = probeRef.current;
    // A result already in hand is the answer — including a negative one. The
    // page tests on open and on every explicit Re-check, so re-testing here
    // would only make a second click on a broken network wait out the same
    // timeout again, to reach the same sentence.
    if (known !== null) return known.ok === true;
    const response = await getJson(route('/status', new URLSearchParams({ diagnose: '1' })));
    if (response === null || response.ok !== true) return false;
    setStatus(response);
    probeRef.current = response.probe ?? null;
    return response.probe?.ok === true;
  }, []);

  /** Adopt a proxy the connectivity test found, then confirm it works. */
  const adoptProxy = React.useCallback(async (proxy) => {
    const ok = await save({ proxy }, { quiet: true });
    if (ok) await probe();
  }, [save, probe]);

  /** Run one search page against the saved configuration. */
  const search = React.useCallback(async (targetPage, targetSeed) => {
    setBusy('search');
    setError(null);
    if (!(await ensureReachable())) {
      setBusy('');
      setResults(null);
      setError(t('unreachable'));
      return;
    }
    const params = new URLSearchParams({ page: String(targetPage) });
    if (typeof targetSeed === 'string' && targetSeed !== '') params.set('seed', targetSeed);
    const response = await getJson(route('/search', params));
    setBusy('');
    if (response === null || response.ok !== true) {
      setResults(null);
      setError(translate(t, 'searchFailed', { reason: response?.reason ?? 'no response' }));
      return;
    }
    setResults(response);
    setPage(response.page);
    setSeed(response.seed ?? '');
  }, [t, ensureReachable]);

  /**
   * Change a filter and show what it now selects.
   *
   * The save must land first: the host builds the request from the stored
   * configuration, so searching before it is written would show the previous
   * filter's results under the new filter's label.
   */
  const saveAndSearch = React.useCallback(async (patch) => {
    const ok = await save(patch, { quiet: true });
    if (ok) await search(1, '');
  }, [save, search]);

  /** Wear one wallpaper: enable first, so a single click has a visible effect. */
  const wear = React.useCallback(async (item) => {
    const ok = await save({
      enabled: true,
      wallpaper: { ...item, chosenAt: new Date().toISOString() },
    });
    if (ok) setNote(t('wearing'));
  }, [save, t]);

  const download = React.useCallback(async (item) => {
    setBusy('download');
    setError(null);
    const response = await postJson(route('/download'), { wallpaper: item });
    setBusy('');
    if (response === null || response.ok !== true) {
      setError(translate(t, 'downloadFailed', { reason: response?.reason ?? 'no response' }));
      return;
    }
    setNote(translate(t, 'downloaded', { path: response.path }));
  }, [t]);

  const categories = maskToFlags(config.categories, CATEGORY_KEYS.length);
  const purity = maskToFlags(config.purity, PURITY_KEYS.length);
  const worn = config.wallpaper;
  const downloadDir = status?.downloadDirectory ?? '';

  const statusLine = probing
    ? t('statusChecking')
    : status === null
      ? ''
      : status.probe === null || status.probe === undefined
        ? ''
        : status.probe.ok === true
          ? translate(t, 'statusOk', { ms: String(status.probe.latencyMs) })
          : translate(t, 'statusBad', { reason: status.probe.reason });

  return h('div', { style: S.page },
    h('div', { style: S.header },
      h('div', null,
        h('h3', { style: S.title }, t('title')),
        h('p', { style: S.subtitle }, t('subtitle'))),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
        h('span', {
          style: {
            fontSize: 11,
            color: status?.probe?.ok === false
              ? 'var(--dsw-alias-state-error-primary, #d33)'
              : 'var(--dsw-alias-label-tertiary)',
          },
        }, statusLine),
        h('button', { type: 'button', style: S.button, disabled: probing, onClick: probe }, t('statusRecheck')))),
    h('div', { style: S.row },
      h('span', { style: S.hint },
        status === null || status.proxy === ''
          ? t('statusProxyNone')
          : translate(t, 'statusProxy', { proxy: status.proxy })),
      // Offered only when the test found one: a proxy the user typed is their
      // decision to make, and a discovered one is only interesting if it works.
      // The latency shown is the *discovery's*, not `probe.latencyMs` — the
      // latter is the failed attempt on the current route.
      status?.probe?.source === 'discovered' && status.probe.discovery !== null
        ? h('span', { style: S.row },
          h('span', { style: { ...S.hint, color: 'var(--dsw-alias-state-success-primary, #22c55e)' } },
            translate(t, 'proxyFound', {
              proxy: status.probe.discovery.proxy,
              ms: String(status.probe.discovery.latencyMs),
            })),
          h('button', {
            type: 'button',
            style: S.buttonPrimary,
            disabled: probing,
            onClick: () => adoptProxy(status.probe.discovery.proxy),
          }, translate(t, 'useProxy', { proxy: status.probe.discovery.proxy })))
        : status?.probe !== null && status?.probe !== undefined && status.probe.ok === false && status.probe.source === 'direct'
          ? h('span', { style: S.hint }, t('proxyNoneFound'))
          : null),

    /* ── the switch ─────────────────────────────────────────────────────── */
    h('div', { style: S.row },
      h(Toggle, {
        checked: config.enabled,
        label: t('enabledLabel'),
        disabled: worn === null,
        onChange: (next) => save({ enabled: next }),
      }),
      h('span', { style: S.hint }, t('enabledHint'))),

    /* ── current background ─────────────────────────────────────────────── */
    h('div', { style: S.section },
      h('div', { style: S.legend }, t('currentTitle')),
      worn === null
        ? h('p', { style: S.note }, t('currentNone'))
        : h('div', { style: S.preview },
          worn.thumb === ''
            ? null
            : h('img', { style: S.previewImage, src: imageUrl(worn.thumb, true), alt: '', loading: 'lazy' }),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 auto' } },
            h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
              worn.resolution === '' ? worn.id : worn.resolution),
            h('div', { style: S.hint },
              [worn.category, worn.purity, worn.fileType.replace('image/', ''), formatBytes(worn.fileSize)]
                .filter((part) => part !== '' && part !== undefined).join(' \xB7 ')),
            worn.colors.length === 0
              ? null
              : h('div', { style: S.swatches }, worn.colors.map((color) => h('span', { key: color, style: { ...S.swatch, background: color } }))),
            h('div', { style: S.row },
              h('button', {
                type: 'button',
                style: S.buttonPrimary,
                disabled: busy === 'download',
                onClick: () => download(worn),
              }, busy === 'download' ? t('downloading') : t('download')),
              h('a', {
                style: { ...S.button, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' },
                href: worn.pageUrl,
                target: '_blank',
                rel: 'noreferrer',
              }, t('openPage')))))),

    note === null ? null : h('p', { style: S.note }, note),
    error === null ? null : h('p', { style: S.error }, error),

    /* ── search ─────────────────────────────────────────────────────────── */
    h('div', { style: S.section },
      h('div', { style: S.legend }, t('searchTitle')),
      h('div', { style: S.row },
        h('input', {
          style: { ...S.input, flex: '1 1 240px' },
          type: 'search',
          value: queryDraft,
          placeholder: t('searchPlaceholder'),
          onChange: (event) => {
            setQueryDraft(event.target.value);
          },
          onKeyDown: (event) => {
            if (event.key !== 'Enter') return;
            save({ query: queryDraft }, { quiet: true }).then(() => search(1, ''));
          },
        }),
        h('button', {
          type: 'button',
          style: S.buttonPrimary,
          disabled: busy === 'search',
          onClick: () => save({ query: queryDraft }, { quiet: true }).then(() => search(1, '')),
        }, busy === 'search' ? t('searching') : t('searchAction'))),

      h(Field, { label: t('categoryLabel') },
        h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          CATEGORY_KEYS.map((key, index) => h('button', {
            key,
            type: 'button',
            style: categories[index] ? S.chipOn : S.chip,
            onClick: () => {
              const next = categories.slice();
              // At least one category must stay on: wallhaven cannot express an
              // empty selection, and silently searching nothing is worse than
              // refusing the click.
              if (next[index] && next.filter(Boolean).length === 1) return;
              next[index] = !next[index];
              saveAndSearch({ categories: flagsToMask(next) });
            },
          }, t(`category${key.charAt(0).toUpperCase()}${key.slice(1)}`))))),

      h(Field, { label: t('purityLabel'), hint: t('purityNote') },
        h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          PURITY_KEYS.map((key, index) => h('button', {
            key,
            type: 'button',
            style: purity[index] ? S.chipOn : S.chip,
            onClick: () => {
              const next = purity.slice();
              // All three are toggleable, SFW included — searching sketchy-only
              // is a legitimate choice and the API expresses it fine. What is
              // refused is turning *everything* off, for the same reason as
              // categories: wallhaven cannot express "no purity", and the empty
              // result reads as "search is broken" rather than "you turned it
              // all off". A refused click says so, because a chip that silently
              // does nothing is indistinguishable from a broken one.
              if (next[index] && next.filter(Boolean).length === 1) {
                setNote(t('purityKeepOne'));
                return;
              }
              next[index] = !next[index];
              saveAndSearch({ purity: flagsToMask(next) });
            },
          }, key.toUpperCase())))),

      h('div', { style: S.row },
        h(Field, { label: t('sortingLabel') },
          h(Picker, {
            value: config.sorting,
            onChange: (value) => saveAndSearch({ sorting: value }),
            options: SORTINGS.map((value) => ({
              value,
              label: t(`sort${value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`),
            })),
          })),
        config.sorting !== 'toplist'
          ? null
          : h(Field, { label: t('rangeLabel') },
            h(Picker, {
              value: config.topRange,
              onChange: (value) => saveAndSearch({ topRange: value }),
              options: TOP_RANGES.map((value) => ({ value, label: value })),
            })),
        h(Field, { label: t('atleastLabel') },
          h(Picker, {
            value: config.atleast,
            onChange: (value) => saveAndSearch({ atleast: value }),
            options: ATLEAST_CHOICES.map((value) => ({ value, label: value === '' ? t('none') : value })),
          })),
        h(Field, { label: t('ratioLabel') },
          h(Picker, {
            value: config.ratios,
            onChange: (value) => saveAndSearch({ ratios: value }),
            options: RATIO_CHOICES.map((value) => ({ value, label: value === '' ? t('none') : value.replace('x', ':') })),
          }))),
      h('p', { style: S.hint }, t('searchHint'))),

    /* ── results ────────────────────────────────────────────────────────── */
    h('div', { style: S.section },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('div', { style: S.legend }, t('resultsTitle')),
        results === null
          ? null
          : h('div', { style: S.row },
            h('span', { style: S.hint }, translate(t, 'pageLabel', {
              page: String(results.page),
              last: String(results.lastPage),
              total: String(results.total),
            })),
            h('button', {
              type: 'button',
              style: S.button,
              disabled: page <= 1 || busy === 'search',
              onClick: () => search(page - 1, seed),
            }, t('pagePrev')),
            h('button', {
              type: 'button',
              style: S.button,
              disabled: page >= results.lastPage || busy === 'search',
              onClick: () => search(page + 1, seed),
            }, t('pageNext')))),
      results === null
        ? h('p', { style: S.note }, t('resultsIdle'))
        : results.items.length === 0
          ? h('p', { style: S.note }, t('searchEmpty'))
          : h('div', { style: S.grid }, results.items.map((item) => h('button', {
            key: item.id,
            type: 'button',
            style: worn !== null && worn.id === item.id ? { ...S.card, ...S.cardOn } : S.card,
            title: item.resolution,
            onClick: () => wear(item),
          },
            h('img', { style: S.thumb, src: imageUrl(item.thumb, true), alt: '', loading: 'lazy' }),
            h('span', { style: S.thumbMeta }, item.resolution))))),

    /* ── appearance ─────────────────────────────────────────────────────── */
    h('div', { style: S.section },
      h('div', { style: S.legend }, t('appearanceTitle')),
      h(Field, { label: t('surfaceLabel'), hint: t('surfaceHint') },
        h(Slider, {
          min: 0,
          max: 1,
          step: 0.01,
          value: config.surfaceOpacity,
          display: config.surfaceOpacity.toFixed(2),
          onChange: (value) => save({ surfaceOpacity: value }, { quiet: true }),
        })),
      h(Field, { label: t('blurLabel') },
        h(Slider, {
          min: 0,
          max: 40,
          step: 1,
          value: config.blur,
          display: `${String(config.blur)}px`,
          onChange: (value) => save({ blur: value }, { quiet: true }),
        })),
      h(Field, { label: t('scrimLabel') },
        h(Slider, {
          min: 0,
          max: 0.8,
          step: 0.02,
          value: config.scrim,
          display: config.scrim.toFixed(2),
          onChange: (value) => save({ scrim: value }, { quiet: true }),
        })),
      h('div', { style: S.row },
        h(Field, { label: t('fitLabel') },
          h(ChipRow, {
            value: config.fit,
            onChange: (value) => save({ fit: value }, { quiet: true }),
            options: FITS.map((value) => ({
              value,
              label: t(`fit${value.charAt(0).toUpperCase()}${value.slice(1)}`),
            })),
          })),
        h(Field, { label: t('positionLabel') },
          h(Picker, {
            value: config.position,
            onChange: (value) => save({ position: value }, { quiet: true }),
            options: POSITIONS.map((value) => ({
              value,
              label: t(`position${value.charAt(0).toUpperCase()}${value.slice(1)}`),
            })),
          })))),

    /* ── where originals go, and how to reach wallhaven ─────────────────── */
    h('div', { style: S.section },
      h('div', { style: S.legend }, t('accessTitle')),
      h(Field, { label: t('downloadDirLabel'), hint: t('downloadDirHint') },
        h('input', {
          style: { ...S.input, flex: '1 1 280px' },
          type: 'text',
          defaultValue: config.downloadDir,
          placeholder: translate(t, 'downloadDirPlaceholder', { dir: downloadDir }),
          onBlur: (event) => save({ downloadDir: event.target.value }, { quiet: true }),
          onKeyDown: (event) => {
            if (event.key === 'Enter') save({ downloadDir: event.target.value }, { quiet: true });
          },
        })),
      h(Field, { label: t('apiKeyLabel'), hint: t('apiKeyHint') },
        h('input', {
          style: { ...S.input, flex: '1 1 280px' },
          type: 'password',
          defaultValue: config.apiKey,
          placeholder: t('apiKeyPlaceholder'),
          onBlur: (event) => save({ apiKey: event.target.value }, { quiet: true }),
          onKeyDown: (event) => {
            if (event.key === 'Enter') save({ apiKey: event.target.value }, { quiet: true });
          },
        })),
      h(Field, { label: t('proxyLabel'), hint: t('proxyHint') },
        h('input', {
          style: { ...S.input, flex: '1 1 280px' },
          type: 'text',
          defaultValue: config.proxy,
          placeholder: t('proxyPlaceholder'),
          onBlur: (event) => save({ proxy: event.target.value }, { quiet: true }).then(() => probe()),
          onKeyDown: (event) => {
            if (event.key === 'Enter') save({ proxy: event.target.value }, { quiet: true }).then(() => probe());
          },
        })),
      status === null
        ? null
        : h('p', { style: S.hint }, translate(t, 'pathsHint', { file: status.configFile }))),

    /* ── what this harness actually gave us ─────────────────────────────── */
    h(CompatSection, { t, compat: props.compat }));
}

/* ── the sidebar shortcut ─────────────────────────────────────────────────── */

/**
 * "换一张" beside Settings: wear a random result of the current search.
 *
 * It goes through the same host route the page uses and never touches the saved
 * sorting, so pressing it cannot quietly rewrite the user's filters.
 *
 * @param props - the slot's composed props; `t` arrives through `inject`.
 */
function ShuffleAction(props) {
  const t = props.t;
  const store = props.store;
  const [busy, setBusy] = React.useState(false);

  const shuffle = React.useCallback(async () => {
    setBusy(true);
    const params = new URLSearchParams({ page: '1', random: '1' });
    const response = await getJson(route('/search', params));
    if (response === null || response.ok !== true || response.items.length === 0) {
      setBusy(false);
      return;
    }
    const picked = response.items[Math.floor(Math.random() * response.items.length)];
    const saved = await postJson(route('/config'), {
      patch: { enabled: true, wallpaper: { ...picked, chosenAt: new Date().toISOString() } },
    });
    if (saved !== null && saved.ok === true) store.adopt(saved.config);
    setBusy(false);
  }, [store]);

  const label = busy ? t('quickBusy') : t('quickLabel');
  return h('button', {
    type: 'button',
    title: t('quickHint'),
    'aria-label': t('quickLabel'),
    disabled: busy,
    onClick: shuffle,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      // The sidebar foot gives this seat very little room; a wrapping label
      // turns "换一张" into two stacked characters, so it must not wrap.
      width: props.wide ? 'auto' : 28,
      height: 28,
      padding: props.wide ? '0 8px' : 0,
      border: 0,
      borderRadius: 8,
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      font: 'inherit',
      whiteSpace: 'nowrap',
    },
  }, props.wide
    ? h('span', { style: { fontSize: 12, whiteSpace: 'nowrap' } }, label)
    : h('span', { style: { fontSize: 15, lineHeight: '1' }, 'aria-hidden': 'true' }, '\u21BB'));
}

/* ── plugin entry ─────────────────────────────────────────────────────────── */

const name = 'dsh-wallhaven-wallpaper';

/*
 * `slots` and `locale` are the two client services this half uses. Declaring
 * them keeps Cordis from applying the plugin before they exist — but it is not
 * a promise that either has the shape this file expects, which is why every use
 * below still goes through a probe that can fail on its own.
 */
const inject = ['slots', 'locale'];

/** One capability row's worth of state, as the page reads it. */
function surfaceState(ok, detail) {
  return { status: ok ? 'ok' : 'missing', detail };
}

/**
 * The live compatibility state, as an observable the page can render.
 *
 * Filled in while `apply()` runs and completed when the host half answers, so
 * the page shows what actually happened rather than what was expected.
 *
 * @returns the store handed to {@link CompatSection}.
 */
function createCompatState() {
  return createStore({
    host: null,
    settings: surfaceState(false, '尚未注册'),
    sidebar: surfaceState(false, '尚未注册'),
    locale: surfaceState(false, '尚未注册'),
  });
}

/**
 * What {@link CompatSection} reads when it was rendered without a state store.
 *
 * The seat always injects one, so this is unreachable in practice — but the
 * section is the thing that *reports* breakage, and a report that itself throws
 * on a harness that passed props differently would be the least useful possible
 * failure.
 */
const EMPTY_COMPAT = createCompatState();

function apply(ctx) {
  const store = createStore(CONFIG_DEFAULTS);
  const background = createBackground();
  const compat = createCompatState();

  ctx.effect(() => () => background.dispose(), 'dsh-wallhaven-wallpaper: background layer');

  // Whatever the theme does — preference switched, registry updated, the OS
  // colour scheme changed while the preference is `system` — the surface
  // colours we read and rewrote are stale, so read them again.
  //
  // This event alone is not sufficient, and that is not a harness bug: it fires
  // before the shell has moved `data-ds-dark-theme` onto `body`, so the handler
  // would read the outgoing palette. `createBackground` therefore also watches
  // that attribute and re-reads when it actually changes — see `watchPalette`.
  // `theme/change` is an ordinary emit, so a harness without it simply never
  // fires this, which is the degradation we want and needs no probe.
  ctx.on('theme/change', () => background.refresh());

  store.subscribe(() => background.sync(store.get()));

  // Paint the remembered wallpaper as early as possible: the settings page may
  // never be opened, but the background must still come back on reload.
  getJson(route('/config')).then((response) => {
    if (response !== null && response.ok === true) store.adopt(response.config);
  });

  // The host half reports the DSH version and its own route outcome. It is
  // fetched rather than assumed, so a host half that never mounted shows up as
  // such instead of being silently misreported.
  getJson(route('/compat')).then((response) => {
    compat.adopt({
      ...compat.get(),
      host: response !== null && response.ok === true ? response : null,
    });
  });

  /* ── copy ──────────────────────────────────────────────────────────────── */

  const dictionaries = { zh, en };
  const registration = registerLocaleDictionary(ctx.locale, NS, dictionaries);
  if (registration.ok) {
    ctx.effect(() => registration.dispose, 'dsh-wallhaven-wallpaper: copy dictionaries');
  } else {
    console.warn(`[${name}] 文案字典未注册，页面将使用插件自带的兜底文案：${registration.error}`);
  }

  // `createTranslator` prefers the harness's own `bind`, so a working locale
  // service keeps live language switching; the fallback keeps the page readable
  // when it does not.
  const translator = createTranslator(ctx.locale, NS, dictionaries, preferredLocale(ctx.locale));
  const t = translator.t;

  compat.adopt({
    ...compat.get(),
    locale: surfaceState(registration.ok, registration.ok ? registration.mode : registration.error),
  });

  /* ── the two seats ─────────────────────────────────────────────────────── */

  // Registered independently on purpose. They are additive seats in different
  // parts of the shell, and a harness that no longer declares one of them must
  // still get the other — the settings page in particular, because that is
  // where the compatibility report is read.
  const settingsSeat = registerSlotSurface(ctx.slots, 'settings.section', {
    id: 'wallhaven-wallpaper',
    order: 41,
    label: () => t('nav'),
    inject: () => ({ t, store, compat }),
  }, WallhavenSection);
  if (settingsSeat.ok) {
    ctx.effect(() => settingsSeat.dispose, 'dsh-wallhaven-wallpaper: settings page');
  } else {
    console.error(`[${name}] 设置页席位未注册（其余功能不受影响）：${settingsSeat.error}`);
  }

  const sidebarSeat = registerSlotSurface(ctx.slots, 'sidebar.footer.action', {
    id: 'wallhaven-shuffle',
    order: 20,
    label: () => t('quickLabel'),
    inject: () => ({ t, store }),
  }, ShuffleAction);
  if (sidebarSeat.ok) {
    ctx.effect(() => sidebarSeat.dispose, 'dsh-wallhaven-wallpaper: sidebar action');
  } else {
    console.warn(`[${name}] 侧边栏席位未注册（设置页不受影响）：${sidebarSeat.error}`);
  }

  compat.adopt({
    ...compat.get(),
    settings: surfaceState(settingsSeat.ok, settingsSeat.ok ? 'settings.section' : settingsSeat.error),
    sidebar: surfaceState(sidebarSeat.ok, sidebarSeat.ok ? 'sidebar.footer.action' : sidebarSeat.error),
  });
}

module.exports = { apply, inject, name };
return module.exports; } });
