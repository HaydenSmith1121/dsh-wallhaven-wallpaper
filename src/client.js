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
  purityNote: 'Sketchy and NSFW need a wallhaven API key.',
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
  proxyHint: 'Empty uses HTTPS_PROXY from the environment. Only http/https proxies are supported.',
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
  compatHostDown: 'The host half did not answer \u2014 it may not be mounted.'
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
  purityNote: 'Sketchy \u4E0E NSFW \u9700\u8981 wallhaven API Key\u3002',
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
  proxyHint: '\u7559\u7A7A\u65F6\u4F7F\u7528\u73AF\u5883\u53D8\u91CF HTTPS_PROXY\u3002\u4EC5\u652F\u6301 http/https \u4EE3\u7406\u3002',
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
  compatHostDown: '\u5BBF\u4E3B\u7AEF\u6CA1\u6709\u5E94\u7B54\u2014\u2014\u5BBF\u4E3B\u534A\u53EF\u80FD\u672A\u6302\u8F7D\u3002'
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

  const probe = React.useCallback(async () => {
    setProbing(true);
    const response = await getJson(route('/status', new URLSearchParams({ probe: '1' })));
    setProbing(false);
    if (response !== null && response.ok === true) setStatus(response);
  }, []);

  React.useEffect(() => {
    probe();
    getJson(route('/status')).then((response) => {
      if (response !== null && response.ok === true) setStatus((current) => current ?? response);
    });
  }, [probe]);

  /** Run one search page against the saved configuration. */
  const search = React.useCallback(async (targetPage, targetSeed) => {
    setBusy('search');
    setError(null);
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
  }, [t]);

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
            color: statusLine.startsWith('\u8FDE') || status?.probe?.ok === false
              ? 'var(--dsw-alias-state-error-primary, #d33)'
              : 'var(--dsw-alias-label-tertiary)',
          },
        }, statusLine),
        h('button', { type: 'button', style: S.button, disabled: probing, onClick: probe }, t('statusRecheck')))),

    h('p', { style: S.hint },
      status === null || status.proxy === ''
        ? t('statusProxyNone')
        : translate(t, 'statusProxy', { proxy: status.proxy })),

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
            // SFW is always on: the host refuses to persist anything else.
            disabled: index === 0,
            style: purity[index] ? S.chipOn : S.chip,
            onClick: () => {
              const next = purity.slice();
              next[index] = !next[index];
              next[0] = true;
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
