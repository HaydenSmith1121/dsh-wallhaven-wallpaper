/**
 * End-to-end verification against a **real** DSH web GUI.
 *
 *   node scripts/verify-gui.mjs --home <DSH_HOME> --origin http://127.0.0.1:43123
 *
 * `verify-client.mjs` proves the bundle works against a mock shell built from
 * the real theme tokens. This goes the last mile: it drives an actual `dsh web`
 * process, so it measures the things a mock cannot — that the loader mounts this
 * package's row, that the client-module carrier serves `lib/client.js` to the
 * page, and that the settings shell renders the section this plugin registered
 * inside the real navigation.
 *
 * Authentication: `dsh web` hands the page a per-process token through
 * `GET /?token=…`, and mints a signed, authority-bound cookie in exchange. This
 * script mints that same cookie directly from the instance's own credential
 * record, which is why it needs `--home`: no browser interaction can produce it
 * without the printed URL.
 *
 * Chrome must already be listening on a CDP port, because DSH's sandbox denies
 * the pipes a browser needs to launch itself:
 *
 *   chrome.exe --headless --remote-debugging-port=9335 --user-data-dir=<dir>
 */

import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/* ── arguments ────────────────────────────────────────────────────────────── */

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const HOME = argument('home', process.env.DSH_HOME ?? '');
const ORIGIN = argument('origin', 'http://127.0.0.1:43123');
const CDP = argument('cdp', 'http://127.0.0.1:9335');
if (HOME === '') {
  console.error('需要 --home <DSH_HOME>：浏览器会话 cookie 只能从该实例自己的凭据记录里派生。');
  process.exit(2);
}

/* ── the cookie `dsh web` would have handed this browser ──────────────────── */

const base64url = (value) => Buffer.from(value).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');

/** The inverse of {@link base64url} — the stored secret is decoded before use. */
const fromBase64url = (value) => Buffer.from(
  value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4),
  'base64',
);

/**
 * Mint the authority-bound browser cookie from the instance's stored secret.
 *
 * The stored value is base64url text that the host decodes into the 32 raw
 * bytes it uses as the HMAC key — signing with the text instead produces a
 * perfectly well-formed cookie that is silently rejected.
 *
 * @returns `{ name, value }` for `context.addCookies`.
 */
async function mintCookie() {
  const credentials = await readFile(join(HOME, '.credentials.yaml'), 'utf8');
  const encoded = /client-connection\/browser-session:[\s\S]*?secret:\s*(\S+)/u.exec(credentials)?.[1];
  if (encoded === undefined) throw new Error(`在 ${HOME}/.credentials.yaml 里找不到 browser-session 密钥`);
  const secret = fromBase64url(encoded);

  const authority = new URL(ORIGIN).host;
  const name = `dsh-auth-${base64url(createHash('sha256').update(authority).digest())}`;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 30 * 24 * 60 * 60 * 1000;
  const body = base64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8'));
  const signature = base64url(createHmac('sha256', secret).update(body).digest());
  return { name, value: `v1.${body}.${signature}` };
}

/* ── the run ──────────────────────────────────────────────────────────────── */

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const cookie = await mintCookie();
const { chromium } = await import(
  'file:///C:/Users/Administrator/AppData/Roaming/npm/node_modules/agent-browser/node_modules/playwright-core/index.mjs'
);

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0] ?? await browser.newContext();
await context.addCookies([{
  name: cookie.name,
  value: cookie.value,
  domain: new URL(ORIGIN).hostname,
  path: '/',
  httpOnly: true,
  sameSite: 'Strict',
}]);

const page = await context.newPage();
await page.setViewportSize({ width: 1600, height: 1000 });

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error.message)));

/** Every plugin-route request the page made, so a missing bundle is visible. */
const requests = [];
page.on('response', (response) => {
  const url = response.url();
  if (url.includes('/plugins')) requests.push({ url: url.slice(0, 200), status: response.status() });
});

try {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const landed = await page.evaluate(() => (document.body.innerText || '').slice(0, 120));
  if (landed.includes('authentication required')) {
    throw new Error(`浏览器会话 cookie 未被接受：${landed.trim()}`);
  }
  // The shell boots over a WebSocket generation handshake; give it room.
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root !== null && root.children.length > 0;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(6000);

  console.log('\n1. the host half is mounted in a real dsh');
  const status = await page.evaluate(async (origin) => {
    const response = await fetch(`${origin}/plugins/dsh-wallhaven-wallpaper/status`);
    return { code: response.status, body: await response.json().catch(() => null) };
  }, ORIGIN);
  check('GET /plugins/dsh-wallhaven-wallpaper/status answers', status.code === 200, `HTTP ${String(status.code)}`);
  check('it reports its own configuration path', typeof status.body?.configFile === 'string' && status.body.configFile.endsWith('config.json'),
    status.body?.configFile ?? '(none)');
  check('it resolved a download directory', typeof status.body?.downloadDirectory === 'string', status.body?.downloadDirectory ?? '(none)');

  console.log('\n2. the client bundle reached the page');
  // The carrier serves client bundles through its own `/plugins` combo route,
  // not through a route this package owns — so the honest check is the network
  // log, not a URL this script invented.
  const carrier = requests.filter((entry) => entry.url.includes('dsh-wallhaven-wallpaper') && entry.status === 200);
  check('the module carrier served this package\'s bundle', carrier.length >= 1,
    carrier.length === 0
      ? requests.map((entry) => `${String(entry.status)} ${entry.url.slice(0, 70)}`).slice(0, 4).join(' | ')
      : `${String(carrier.length)} response(s), e.g. ${carrier[0].url.slice(0, 90)}`);

  const registered = await page.evaluate(() => {
    const loader = window.__ModuleLoader__;
    return loader === undefined ? { ok: false, reason: 'no __ModuleLoader__' } : { ok: true };
  });
  check('the page still has its module loader', registered.ok === true, registered.reason ?? '');

  console.log('\n3. the settings shell shows the section');
  // Open Settings through the real sidebar control, the way a person would.
  const opened = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    const trigger = candidates.find((element) => {
      const label = `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`;
      return /设置|Settings/u.test(label);
    });
    if (trigger === undefined) return false;
    trigger.click();
    return true;
  });
  check('the settings trigger was found and clicked', opened === true);
  await page.waitForTimeout(3000);

  const nav = await page.evaluate(() => ({
    text: (document.body.innerText || '').slice(0, 4000),
  }));
  check('the navigation lists 壁纸', /壁纸/u.test(nav.text),
    nav.text.split('\n').filter((line) => line.trim() !== '').slice(0, 12).join(' | '));

  // Click the section and let its page mount.
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], li, a'));
    const item = candidates.find((element) => (element.textContent ?? '').trim() === '壁纸');
    if (item === undefined) return false;
    item.click();
    return true;
  });
  check('the 壁纸 navigation entry was clicked', clicked === true);
  await page.waitForTimeout(5000);

  const panel = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      hasTitle: text.includes('Wallhaven 壁纸'),
      hasSearch: text.includes('搜索'),
      hasAppearance: text.includes('界面不透明度'),
      hasAccess: text.includes('wallhaven API Key'),
      buttons: document.querySelectorAll('button').length,
    };
  });
  check('the wallpaper page rendered its title', panel.hasTitle === true);
  check('it rendered the search controls', panel.hasSearch === true);
  check('it rendered the appearance controls', panel.hasAppearance === true);
  check('it rendered the access controls', panel.hasAccess === true);
  check('the shell as a whole is still interactive', panel.buttons > 20, `${String(panel.buttons)} buttons in the document`);

  console.log('\n4. a live search from inside the real GUI');
  const searched = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const search = buttons.find((button) => (button.textContent ?? '').trim() === '搜索');
    if (search === undefined) return false;
    search.click();
    return true;
  });
  check('the search button was pressed', searched === true);
  await page.waitForTimeout(9000);

  const grid = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll('img')).filter((image) => image.src.includes('/plugins/dsh-wallhaven-wallpaper/image'));
    return {
      count: images.length,
      loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
    };
  });
  check('result thumbnails were rendered', grid.count >= 20, `${String(grid.count)} thumbnails`);
  check('and their bytes actually arrived through the plugin', grid.loaded >= 5, `${String(grid.loaded)} decoded`);

  console.log('\n5. wearing one in the real shell');
  await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll('img')).filter((image) => image.src.includes('/plugins/dsh-wallhaven-wallpaper/image'));
    const target = images[Math.floor(images.length / 2)];
    const button = target?.closest('button');
    button?.click();
  });
  await page.waitForTimeout(7000);

  const worn = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const layer = document.querySelector('[data-dsh-wh-layer]');
    const image = document.querySelector('[data-dsh-wh-image]');
    return {
      layer: layer !== null,
      background: image === null ? '' : getComputedStyle(image).backgroundImage.slice(0, 120),
      base: body.getPropertyValue('--dsw-alias-bg-base').trim(),
      sidebar: body.getPropertyValue('--dsw-specific-sidebar-fill').trim(),
      dark: document.body.hasAttribute('data-ds-dark-theme'),
    };
  });
  check('the wallpaper layer is in the real document', worn.layer === true);
  check('it points at this plugin\'s image route', worn.background.includes('/plugins/dsh-wallhaven-wallpaper/image?src='), worn.background);
  check('the shell canvas token was rewritten to translucent', /rgba\(/u.test(worn.base), `${worn.base} (${worn.dark ? 'dark' : 'light'} palette)`);
  check('the sidebar token was rewritten too', /rgba\(/u.test(worn.sidebar), worn.sidebar);

  // The picture worth keeping: the real shell wearing a real wallpaper.
  await page.screenshot({ path: join(process.cwd(), 'docs', 'settings.png') });

  console.log('\n6. turning it off leaves the shell as it was');
  await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('input[type=checkbox]'));
    const box = boxes.find((candidate) => candidate.closest('label')?.textContent?.includes('启用界面壁纸'));
    if (box !== null && box !== undefined && box.checked) box.click();
  });
  await page.waitForTimeout(3000);
  const restored = await page.evaluate(() => ({
    layer: document.querySelector('[data-dsh-wh-layer]') !== null,
    base: getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim(),
  }));
  check('the layer was removed', restored.layer === false);
  check('the token went back to the theme\'s own value', restored.base !== '' && !restored.base.startsWith('rgba('), restored.base);

  console.log('\n7. console hygiene');
  const noise = consoleErrors.filter((line) => !/favicon|Download the React DevTools/u.test(line));
  check('no console errors from the plugin', noise.length === 0, noise.slice(0, 3).join(' | '));
  console.log(`   该页共发出 ${String(requests.length)} 个本插件请求`);
} finally {
  await page.screenshot({ path: join(process.cwd(), 'docs', 'verify-gui.png') }).catch(() => undefined);
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}

console.log(`\n截图：docs/verify-gui.png`);
console.log(`${failures === 0 ? '全部通过' : `${String(failures)} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
