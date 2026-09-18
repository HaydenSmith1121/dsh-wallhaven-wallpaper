/**
 * Render verification: the real client bundle, in a real browser, against the
 * real DSH theme tokens and the real host half.
 *
 *   node scripts/verify-client.mjs
 *
 * What this proves that the unit suite cannot:
 *   · `lib/client.js` parses inside DSH's `window.__ModuleLoader__` envelope and
 *     registers both of its surfaces without throwing;
 *   · the settings page renders under React 18 with the props a real slot hands
 *     it, and every control writes through to the host;
 *   · the background layer appears, and the shell's own `--dsw-*` surface tokens
 *     are actually rewritten to translucent values — read back from a live
 *     `getComputedStyle`, not asserted against a string this script built.
 *
 * The tokens are extracted from the installed DSH rather than copied into this
 * repository, so the test measures the product's current palette and cannot
 * drift into passing against a stale snapshot.
 *
 * Requires: a DSH install (for the theme tokens and shell CSS), React 18 UMD on
 * disk, a browser reachable over CDP, and a proxy if the network needs one.
 *
 * Chrome must be started separately, because DSH's sandbox denies the pipes a
 * browser needs to launch itself:
 *
 *   chrome.exe --headless --remote-debugging-port=9335 --user-data-dir=<dir>
 */

import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import { createRouteHandler } from '../src/host/routes.js';
import { createWallhaven } from '../src/host/wallhaven.js';
import { openConfigStore } from '../src/host/store.js';
import { ROUTE_BASE } from '../src/shared/constants.js';

const CDP_URL = process.env.DSH_CDP_URL ?? 'http://127.0.0.1:9335';
const DSH_ROOT = process.env.DSH_APP_ROOT
  ?? 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\DSH Desktop Beta\\resources\\app';

/** Where React 18 UMD lives, in the order we prefer it. */
const REACT_CANDIDATES = [
  join(DSH_ROOT, 'node_modules'),
  'D:\\deepseek\\dsh-excel-viewer\\node_modules',
];

/** Resolve a directory that holds both `react` and `react-dom` UMD builds. */
function findReactRoot() {
  for (const candidate of REACT_CANDIDATES) {
    if (existsSync(join(candidate, 'react', 'umd', 'react.development.js'))
      && existsSync(join(candidate, 'react-dom', 'umd', 'react-dom.development.js'))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Pull the token rule blocks out of the theme bundle.
 *
 * The tokens are a CSS string inside `dsh-client-ui-theme/lib/client.js`; brace
 * matching recovers them without depending on how that string is spelled. The
 * selectors matter: DSH puts the light palette on `body` and the dark one on
 * `body[data-ds-dark-theme]`, which is precisely why the plugin must override
 * there rather than on `:root`.
 *
 * @returns the concatenated CSS.
 */
async function readThemeCss() {
  const bundle = await readFile(
    join(DSH_ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'),
    'utf8',
  );
  const blocks = [];
  for (const selector of [':root{', 'body{', 'body[data-ds-dark-theme]{']) {
    let from = 0;
    for (;;) {
      let start = -1;
      for (;;) {
        const candidate = bundle.indexOf(selector, from);
        if (candidate < 0) break;
        // Only a rule boundary counts, so `something body{` is not mistaken for
        // a top-level `body{` rule. A quote counts too: the whole sheet is a JS
        // string literal, and the very first rule — the light palette — starts
        // immediately after the opening quote.
        const before = bundle.slice(Math.max(0, candidate - 40), candidate).trimEnd();
        if (before === '' || /[};{"'`]$/.test(before)) {
          start = candidate;
          break;
        }
        from = candidate + 1;
      }
      if (start < 0) break;
      let depth = 0;
      let end = -1;
      for (let index = start + selector.length - 1; index < bundle.length; index += 1) {
        const char = bundle[index];
        if (char === '{') depth += 1;
        else if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            end = index;
            break;
          }
        }
      }
      if (end < 0) break;
      blocks.push(bundle.slice(start, end + 1));
      from = end + 1;
    }
  }
  if (blocks.length === 0) throw new Error('未能从 ui-theme 中提取 --dsw-* token');
  return blocks.join('\n');
}

/* ── the harness page ─────────────────────────────────────────────────────── */

/**
 * The mock shell and the mock Cordis context.
 *
 * The mock shell reproduces the two facts the background logic depends on:
 * `html, body, #root` are full height, and the app's surfaces are painted from
 * the alias tokens rather than from hard-coded colours.
 */
const PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="/vendor.css" />
<link rel="stylesheet" href="/shell.css" />
<link rel="stylesheet" href="/theme.css" />
<style>
  html, body, #root { height: 100%; margin: 0; }
  body { background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #111); }
  .harness-shell { display: flex; height: 100%; }
  .harness-sidebar { width: 240px; background: var(--dsw-specific-sidebar-fill, #f9fafb); border-right: 1px solid var(--dsw-alias-border-l1); padding: 12px; box-sizing: border-box; }
  .harness-main { flex: 1; padding: 16px; overflow: auto; box-sizing: border-box; }
  .harness-card { background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 12px; }
</style>
</head>
<body>
  <div id="root"><div class="harness-shell">
    <div class="harness-sidebar"><div class="harness-card">侧边栏</div></div>
    <div class="harness-main"><div class="harness-card"><div id="harness-mount"></div></div></div>
  </div></div>

  <script src="/react.js"></script>
  <script src="/react-dom.js"></script>
  <script>
    /* The carrier facade: DSH loads plugin bundles as classic scripts that call
       this and nothing else. */
    window.__dshHarness = { registered: [], components: {} };
    window.__ModuleLoader__ = {
      load({ id, factory }) {
        window.__dshHarness.registered.push(id);
        try {
          window.__dshHarness.exports = factory((name) => {
            if (name === 'react') return window.React;
            throw new Error('harness require does not provide ' + name);
          });
        } catch (error) {
          window.__dshHarness.loadError = String(error && error.stack || error);
        }
      },
    };
  </script>
  <script src="/client.js"></script>
  <script>
    (function () {
      var harness = window.__dshHarness;
      var dicts = {};
      var effects = [];
      var listeners = [];
      var slots = [];

      function makeT(namespace) {
        return function (key, params) {
          var table = dicts[namespace] || {};
          var value = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
          if (params === undefined) return value;
          return value.replace(/\\{(\\w+)\\}/g, function (match, name) {
            return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
          });
        };
      }

      var ctx = {
        effect: function (fn) { effects.push(fn()); return function () {}; },
        on: function (name, fn) { listeners.push({ name: name, fn: fn }); },
        get: function () { return undefined; },
        locale: {
          register: function (ns, table) { dicts[ns] = table.zh || table.en; return function () {}; },
          bind: function (ns) { return makeT(ns); },
        },
        slots: {
          /* Real slots.inject runs the callback once the slot is declared;
             these two product slots always exist, so declaring is immediate. */
          inject: function (key, callback) {
            slots.push({ key: key, callback: callback });
            harness.slotKeys = slots.map(function (entry) { return entry.key; });
            callback();
            return function () {};
          },
          register: function (options, component) {
            harness.components[options.name + '#' + options.id] = { options: options, component: component };
            return function () {};
          },
        },
      };

      if (harness.exports === undefined) return;
      try {
        harness.exports.apply(ctx);
      } catch (error) {
        harness.applyError = String(error && error.stack || error);
        return;
      }
      harness.slotKeys = slots.map(function (entry) { return entry.key; });

      /* Render the settings section exactly as the shell would: look up the
         registration, call its inject factory, and mount the component with
         React 18's createRoot. */
      var registration = harness.components['settings.section#wallhaven-wallpaper'];
      if (registration === undefined) {
        harness.renderError = 'settings.section#wallhaven-wallpaper was never registered';
        return;
      }
      var business = registration.options.inject();
      harness.businessKeys = Object.keys(business);
      try {
        var root = ReactDOM.createRoot(document.getElementById('harness-mount'));
        root.render(React.createElement(registration.component, Object.assign({
          wide: true,
          close: function () {},
        }, business)));
        harness.rendered = true;
      } catch (error) {
        harness.renderError = String(error && error.stack || error);
      }

      harness.emitThemeChange = function () {
        listeners.filter(function (entry) { return entry.name === 'theme/change'; })
          .forEach(function (entry) { entry.fn({}); });
      };
      harness.dispose = function () { effects.forEach(function (fn) { if (typeof fn === 'function') fn(); }); };
    })();
  </script>
</body>
</html>`;

/* ── the server ───────────────────────────────────────────────────────────── */

const home = await mkdtemp(join(tmpdir(), 'dsh-wh-render-'));
const store = openConfigStore({ dshHome: home });
await store.load();

const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? '';
if (proxy !== '') await store.update({ proxy });
await store.update({ downloadDir: join(home, 'downloads') });

const wallhaven = createWallhaven({ store });
const routeHandler = createRouteHandler({ store, wallhaven, ready: Promise.resolve() });

const themeCss = await readThemeCss();
const reactRoot = findReactRoot();
if (reactRoot === null) {
  console.error('找不到 React 18 UMD：请设置 DSH_APP_ROOT，或在 REACT_CANDIDATES 里补一个路径。');
  process.exit(2);
}

const shellCss = join(DSH_ROOT, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets', 'index-J8NrHpw_.css');
const vendorCss = join(DSH_ROOT, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets', 'vendor-BNsW4eBh.css');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  if (path.startsWith(ROUTE_BASE)) {
    // The plugin's own host half, unmodified: the page below talks to the real
    // routes, so a broken route is a broken harness.
    await routeHandler(req, res);
    return;
  }

  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  try {
    if (path === '/') return send(200, 'text/html; charset=utf-8', PAGE);
    if (path === '/favicon.ico') return send(204, 'image/x-icon', '');
    if (path === '/theme.css') return send(200, 'text/css; charset=utf-8', themeCss);
    if (path === '/shell.css') return send(200, 'text/css; charset=utf-8', await readFile(shellCss));
    if (path === '/vendor.css') return send(200, 'text/css; charset=utf-8', await readFile(vendorCss));
    if (path === '/react.js') {
      return send(200, 'text/javascript; charset=utf-8', await readFile(join(reactRoot, 'react', 'umd', 'react.development.js')));
    }
    if (path === '/react-dom.js') {
      return send(200, 'text/javascript; charset=utf-8', await readFile(join(reactRoot, 'react-dom', 'umd', 'react-dom.development.js')));
    }
    if (path === '/client.js') {
      return send(200, 'text/javascript; charset=utf-8', await readFile(new URL('../lib/client.js', import.meta.url)));
    }
    return send(404, 'text/plain; charset=utf-8', 'not found');
  } catch (error) {
    return send(500, 'text/plain; charset=utf-8', error.message);
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${String(server.address().port)}`;
console.log(`harness: ${origin}`);

/* ── drive it ─────────────────────────────────────────────────────────────── */

const { chromium } = await import(
  'file:///C:/Users/Administrator/AppData/Roaming/npm/node_modules/agent-browser/node_modules/playwright-core/index.mjs'
);

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.connectOverCDP(CDP_URL);
const context = browser.contexts()[0] ?? await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1500, height: 1000 });

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error.message)));

try {
  await page.goto(origin, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2500);

  const boot = await page.evaluate(() => {
    const harness = window.__dshHarness;
    return {
      registered: harness.registered,
      loadError: harness.loadError ?? null,
      applyError: harness.applyError ?? null,
      renderError: harness.renderError ?? null,
      slotKeys: harness.slotKeys ?? null,
      businessKeys: harness.businessKeys ?? null,
      rendered: harness.rendered === true,
      sections: Object.keys(harness.components),
    };
  });

  console.log('\n1. bundle load and registration');
  check('bundle registered under the package name', boot.registered.includes('dsh-wallhaven-wallpaper'), boot.registered.join(','));
  check('no factory error', boot.loadError === null, boot.loadError ?? '');
  check('apply() ran without throwing', boot.applyError === null, boot.applyError ?? '');
  check('both slots were injected', JSON.stringify(boot.slotKeys) === JSON.stringify(['settings.section', 'sidebar.footer.action']), JSON.stringify(boot.slotKeys));
  check('both surfaces registered', boot.sections.length === 2, boot.sections.join(' | '));
  check('the section renders', boot.rendered && boot.renderError === null, boot.renderError ?? '');

  console.log('\n2. the page is a working UI');
  const dom = await page.evaluate(() => {
    const mount = document.getElementById('harness-mount');
    return {
      text: (mount.innerText || '').slice(0, 4000),
      inputs: mount.querySelectorAll('input').length,
      selects: mount.querySelectorAll('select').length,
      buttons: mount.querySelectorAll('button').length,
      rangeInputs: mount.querySelectorAll('input[type=range]').length,
    };
  });
  check('rendered controls', dom.buttons > 10 && dom.inputs >= 2 && dom.selects >= 2 && dom.rangeInputs === 3,
    `${String(dom.buttons)} buttons / ${String(dom.inputs)} inputs / ${String(dom.selects)} selects / ${String(dom.rangeInputs)} sliders`);
  check('copy came from the zh dictionary', dom.text.includes('Wallhaven') && dom.text.includes('搜索') && dom.text.includes('界面不透明度'),
    dom.text.split('\n').slice(0, 3).join(' / '));

  // A filled control whose label is the same colour as its fill is invisible.
  // DSH's brand primary is a neutral high-contrast surface — near black in the
  // light palette, near white in the dark one — so "white text on brand" is
  // right on exactly one of them. Measured, in both palettes, below.
  const measureContrast = () => page.evaluate(() => {
    const luminance = (value) => {
      const parts = /(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
      if (parts === null) return null;
      const channel = (raw) => {
        const scaled = Number(raw) / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(parts[1]) + 0.7152 * channel(parts[2]) + 0.0722 * channel(parts[3]);
    };
    const buttons = Array.from(document.querySelectorAll('#harness-mount button'));
    const search = buttons.find((button) => button.textContent.trim() === '搜索');
    if (search === undefined) return null;
    const style = getComputedStyle(search);
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    if (foreground === null || background === null) return null;
    const lighter = Math.max(foreground, background);
    const darker = Math.min(foreground, background);
    return { ratio: (lighter + 0.05) / (darker + 0.05), color: style.color, background: style.backgroundColor };
  });
  const lightContrast = await measureContrast();
  check('the primary button\'s label is legible on its fill (light)',
    lightContrast !== null && lightContrast.ratio >= 3,
    lightContrast === null ? 'could not measure' : `contrast ${lightContrast.ratio.toFixed(2)}:1 (${lightContrast.color} on ${lightContrast.background})`);

  console.log('\n3. the host half answers the page');
  const status = await page.evaluate(async () => {
    const response = await fetch('/plugins/dsh-wallhaven-wallpaper/status');
    return response.json();
  });
  check('GET /status answered', status.ok === true, status.configFile);
  check('it reports the proxy in effect', status.proxy === proxy, status.proxy === '' ? '(direct)' : status.proxy);

  const search = await page.evaluate(async () => {
    const response = await fetch('/plugins/dsh-wallhaven-wallpaper/search?page=1');
    return response.json();
  });
  check('live search through the plugin\'s own route', search.ok === true && search.items.length > 0,
    search.ok ? `${String(search.items.length)} items` : search.reason);

  console.log('\n4. wearing a wallpaper');
  // Drive the UI the way a person does: press 搜索, wait for the grid, then
  // click the first result, which wears it.
  const pressed = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('#harness-mount button'));
    const search = buttons.find((button) => button.textContent.trim() === '搜索');
    if (search === undefined) return false;
    search.click();
    return true;
  });
  check('the search button is there to press', pressed === true);
  await page.waitForTimeout(6000);

  const firstThumbLoaded = await page.evaluate(async () => {
    const image = document.querySelector('#harness-mount img');
    if (image === null) return 'no thumbnail rendered';
    if (image.complete && image.naturalWidth > 0) return true;
    return await new Promise((resolve) => {
      image.addEventListener('load', () => resolve(true), { once: true });
      image.addEventListener('error', () => resolve('thumbnail failed to load'), { once: true });
      setTimeout(() => resolve('thumbnail timed out'), 20000);
    });
  });
  check('a result thumbnail actually loaded bytes', firstThumbLoaded === true, String(firstThumbLoaded));

  await page.evaluate(() => {
    const mount = document.getElementById('harness-mount');
    const grid = mount.querySelectorAll('button');
    for (const button of grid) {
      if (button.querySelector('img') !== null) {
        button.click();
        return;
      }
    }
  });
  await page.waitForTimeout(4000);

  const worn = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const layer = document.querySelector('[data-dsh-wh-layer]');
    const image = document.querySelector('[data-dsh-wh-image]');
    const dynamic = document.querySelector('style[data-plugin-css="dsh-wallhaven-wallpaper-dynamic"]');
    return {
      enabled: layer !== null,
      dynamicCss: dynamic === null ? '' : dynamic.textContent,
      backgroundImage: image === null ? '' : getComputedStyle(image).backgroundImage.slice(0, 160),
      base: body.getPropertyValue('--dsw-alias-bg-base').trim(),
      sidebar: body.getPropertyValue('--dsw-specific-sidebar-fill').trim(),
      layer1: body.getPropertyValue('--dsw-alias-bg-layer-1').trim(),
      overlay: body.getPropertyValue('--dsw-alias-bg-overlay').trim(),
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      layerZ: image === null ? '' : getComputedStyle(layer).zIndex,
    };
  });
  console.log('   动态样式表：\n' + worn.dynamicCss.split('\n').map((line) => `     ${line}`).join('\n'));

  check('the wallpaper layer exists', worn.enabled === true);
  check('it points at the plugin\'s image route', worn.backgroundImage.includes('/plugins/dsh-wallhaven-wallpaper/image?src='), worn.backgroundImage);
  check('the canvas token is now translucent', /rgba\([^)]*0\.7\d*\)/.test(worn.base), worn.base);
  check('the sidebar token is translucent too', /rgba\(/.test(worn.sidebar), worn.sidebar);
  check('raised surfaces are more opaque than the canvas', /0\.8\d*\)|0\.9\d*\)/.test(worn.layer1), worn.layer1);
  check('the html canvas is opaque so body paints above the layer', !worn.htmlBackground.includes('rgba(0, 0, 0, 0)'), worn.htmlBackground);

  console.log('\n5. the background survives a theme flip');
  await page.evaluate(() => {
    document.body.setAttribute('data-ds-dark-theme', '');
    window.__dshHarness.emitThemeChange();
  });
  await page.waitForTimeout(600);
  const dark = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const image = document.querySelector('[data-dsh-wh-image]');
    return {
      base: body.getPropertyValue('--dsw-alias-bg-base').trim(),
      backgroundImage: image === null ? '' : getComputedStyle(image).backgroundImage.length,
      darkTokens: getComputedStyle(document.body).getPropertyValue('--dsw-static-neutral-bluish-950').trim(),
    };
  });
  check('dark tokens are in force', dark.darkTokens !== '', dark.darkTokens);
  check('the canvas token is re-derived for dark, not left on the light value', /rgba\(2[0-9], 2[0-9], 2[0-9]/.test(dark.base), dark.base);
  check('the wallpaper is still worn', dark.backgroundImage > 0);

  const darkContrast = await measureContrast();
  check('the primary button\'s label is legible on its fill (dark)',
    darkContrast !== null && darkContrast.ratio >= 3,
    darkContrast === null ? 'could not measure' : `contrast ${darkContrast.ratio.toFixed(2)}:1 (${darkContrast.color} on ${darkContrast.background})`);

  console.log('\n6. switching it off restores the shell');
  await page.evaluate(() => {
    const box = document.querySelector('#harness-mount input[type=checkbox]');
    if (box !== null && box.checked) box.click();
  });
  await page.waitForTimeout(1500);
  const off = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return {
      layer: document.querySelector('[data-dsh-wh-layer]') !== null,
      dynamicCss: (document.querySelector('style[data-plugin-css="dsh-wallhaven-wallpaper-dynamic"]') ?? {}).textContent ?? '',
      base: body.getPropertyValue('--dsw-alias-bg-base').trim(),
    };
  });
  check('the layer is gone', off.layer === false);
  check('the token overrides are gone', off.dynamicCss.trim() === '', JSON.stringify(off.dynamicCss.slice(0, 60)));
  check('the shell token is back to its own value', off.base !== '' && !off.base.startsWith('rgba('), off.base);

  console.log('\n7. console hygiene');
  const noise = consoleErrors.filter((line) => !line.includes('favicon'));
  check('no console errors', noise.length === 0, noise.slice(0, 3).join(' | '));

  await mkdir(join(process.cwd(), 'docs'), { recursive: true });
  await page.screenshot({ path: join(process.cwd(), 'docs', 'verify-render.png'), fullPage: false });
  console.log('\n截图：docs/verify-render.png');
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  server.close();
  await rm(home, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? '全部通过' : `${String(failures)} 项失败`}`);
// The CDP transport keeps a socket (and therefore the event loop) alive after
// `close()`, so the exit code is set explicitly rather than waited for.
process.exit(failures === 0 ? 0 : 1);
