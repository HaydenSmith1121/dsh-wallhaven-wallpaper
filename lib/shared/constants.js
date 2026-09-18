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
export const PKG = 'dsh-wallhaven-wallpaper';

/** Every host route this plugin owns lives under this prefix. */
export const ROUTE_BASE = '/plugins/dsh-wallhaven-wallpaper';

/** wallhaven's public API v1. */
export const API_BASE = 'https://wallhaven.cc/api/v1';

/**
 * The only hosts the host half will fetch image bytes from.
 *
 * The browser never talks to wallhaven itself: it asks this plugin's own
 * `/image` route, which fetches the URL server-side. That is what makes the
 * plugin work when the browser cannot reach wallhaven (blocked DNS, no proxy
 * configured for the page) and what keeps a stray `src` from turning the route
 * into an open relay.
 */
export const IMAGE_HOSTS = ['w.wallhaven.cc', 'th.wallhaven.cc'];

/** wallhaven search: `categories` is three positional flags, in this order. */
export const CATEGORY_KEYS = ['general', 'anime', 'people'];

/** wallhaven search: `purity` is three positional flags, in this order. */
export const PURITY_KEYS = ['sfw', 'sketchy', 'nsfw'];

/** wallhaven search: `sorting` values accepted by the API. */
export const SORTINGS = ['date_added', 'relevance', 'random', 'views', 'favorites', 'toplist'];

/** wallhaven search: `order` values accepted by the API. */
export const ORDERS = ['desc', 'asc'];

/** wallhaven search: `topRange` values; only meaningful with `sorting=toplist`. */
export const TOP_RANGES = ['1d', '3d', '1w', '1M', '3M', '6M', '1y'];

/** Offered in the page's resolution picker; `''` means "no minimum". */
export const ATLEAST_CHOICES = ['', '1920x1080', '2560x1440', '3440x1440', '3840x2160'];

/** Offered in the page's ratio picker; `''` means "any ratio". */
export const RATIO_CHOICES = ['', '16x9', '16x10', '21x9', '9x16', '1x1'];

/** How the wallpaper is scaled onto the viewport. */
export const FITS = ['cover', 'contain', 'fill', 'tile'];

/** How the wallpaper is anchored when it does not fill the viewport. */
export const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];

/** A page of wallhaven search results is always 24 items. */
export const PER_PAGE = 24;

/**
 * The resolved configuration, with every default in one place.
 *
 * `wallpaper` is the currently worn image (or `null`). It is stored resolved —
 * thumbnail URL, original URL, resolution, colours — rather than as an id, so
 * that reloading the page can repaint the background without a single network
 * call to wallhaven.
 */
export const CONFIG_DEFAULTS = {
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
export const THUMB_SIZE = 'thumb';
export const PREVIEW_SIZE = 'preview';
export const FULL_SIZE = 'full';

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
export function maskToFlags(mask, length) {
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
export function flagsToMask(flags) {
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
export function isAllowedImageUrl(value) {
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
export function normalizeWallpaper(value) {
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
export function normalizeConfig(raw, base) {
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
    // SFW can never be turned off: a plugin must not be able to persist a
    // configuration that only returns adult content.
    flags[0] = true;
    next.purity = flagsToMask(flags);
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
export function buildSearchParams(config, page, seed) {
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
export function searchItemToWallpaper(row) {
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
export function parseSearchResponse(payload) {
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
export function parseColor(value) {
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
export function surfaceOverrideSelector(isDark) {
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
export function fadeColor(value, factor) {
  const parsed = parseColor(value);
  if (parsed === null) return null;
  const alpha = Math.min(1, Math.max(0, parsed[3] * factor));
  return `rgba(${String(parsed[0])}, ${String(parsed[1])}, ${String(parsed[2])}, ${alpha.toFixed(3)})`;
}
