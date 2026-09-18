/*
 * The host routes the settings page talks to.
 *
 * One prefix registration, dispatched internally: `register()` treats a
 * duplicate `(kind, path)` as a composition error, so claiming the shortest
 * correct prefix once and routing beneath it keeps this plugin's surface
 * auditable in a single place.
 *
 * The image route is deliberately the only one that streams: search results are
 * a few kilobytes of JSON, whereas an original is regularly 5–20 MB, and
 * buffering one of those to answer a request would be a memory leak with extra
 * steps.
 */

import { PKG, ROUTE_BASE, normalizeConfig } from '../shared/constants.js';
import { defaultDownloadDirectory } from './wallhaven.js';

/** Largest JSON body accepted from the page, in bytes. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Write one JSON response.
 *
 * @param res - the server response.
 * @param status - the HTTP status.
 * @param payload - a JSON-serializable value.
 */
function sendJson(res, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/**
 * Send `405` for a method this route does not implement.
 *
 * @param res - the server response.
 * @param allowed - the methods that would have worked.
 */
function sendMethodNotAllowed(res, allowed) {
  res.writeHead(405, { allow: allowed.join(', '), 'content-type': 'text/plain; charset=utf-8' });
  res.end('method not allowed');
}

/**
 * Read and decode a JSON request body, refusing anything oversized.
 *
 * Throws a `body`-tagged error: the difference between "the caller sent
 * nonsense" (400) and "this plugin broke" (500) is worth keeping, because only
 * one of them is the user's to fix.
 *
 * @param req - the incoming request.
 * @returns the decoded value, or `undefined` when it was absent.
 */
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw taggedBodyError(`请求体超过 ${String(MAX_BODY_BYTES)} 字节`);
    chunks.push(chunk);
  }
  if (total === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw taggedBodyError('请求体不是合法 JSON');
  }
}

/** Mark an error as the caller's fault rather than this plugin's. */
function taggedBodyError(message) {
  const error = new Error(message);
  error.dshBodyError = true;
  return error;
}

/**
 * Decide whether a request may change this plugin's settings.
 *
 * The web server carries no authentication of its own, by design, and is
 * loopback-only unless somebody deliberately widened it. This plugin therefore
 * adds the one check it can make honestly: a browser request must come from the
 * GUI's own origin. That stops a random page the user visits from silently
 * POSTing a new proxy into this plugin — which would be a request-forgery
 * primitive aimed at every host the proxy can reach — without pretending to be
 * an authentication layer it is not. The residual exposure (anything that can
 * already open a socket to the port) is stated in the README.
 *
 * @param req - the incoming request.
 * @returns `true` when the request may write.
 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true; // Non-browser client.
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Build the request handler for this plugin's route prefix.
 *
 * @param options - `{ store, wallhaven, logger, ready }`, where `ready` is the
 *   first-load promise every request waits on so no request is ever answered
 *   from a half-loaded configuration.
 * @returns a handler matching `WebRoute['handler']`.
 */
export function createRouteHandler(options) {
  const store = options.store;
  const wallhaven = options.wallhaven;
  const logger = options.logger;
  const ready = options.ready;

  /** What the page needs to draw its status line. */
  async function statusPayload(probe) {
    const config = store.get();
    const paths = store.describe();
    const downloadDir = config.downloadDir === '' ? defaultDownloadDirectory() : config.downloadDir;
    return {
      ok: true,
      configFile: paths.file,
      cacheDirectory: wallhaven.cacheDirectory(),
      downloadDirectory: downloadDir,
      proxy: wallhaven.proxyInEffect(),
      probe: probe ? await wallhaven.probe() : null,
    };
  }

  return async function handle(req, res) {
    if (ready !== undefined) await ready;

    let pathname = '/';
    let search = new URLSearchParams();
    try {
      const parsed = new URL(req.url ?? '/', 'http://dsh.invalid');
      pathname = parsed.pathname.slice(ROUTE_BASE.length);
      search = parsed.searchParams;
    } catch {
      sendJson(res, 400, { ok: false, reason: '请求 URL 无法解析。' });
      return;
    }

    try {
      if (pathname === '/config') {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, config: store.get() });
          return;
        }
        if (req.method === 'POST') {
          if (!isSameOrigin(req)) {
            sendJson(res, 403, { ok: false, reason: '跨站请求被拒绝。' });
            return;
          }
          const body = await readJsonBody(req);
          if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            sendJson(res, 400, { ok: false, reason: '请求体必须是配置对象。' });
            return;
          }
          const patch = body['patch'] ?? body;
          const config = await store.update(patch);
          sendJson(res, 200, { ok: true, config });
          return;
        }
        sendMethodNotAllowed(res, ['GET', 'POST']);
        return;
      }

      if (pathname === '/search') {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, ['GET']);
          return;
        }
        const page = Number(search.get('page') ?? '1');
        const seed = search.get('seed') ?? '';
        sendJson(res, 200, await wallhaven.search({
          page: Number.isFinite(page) ? page : 1,
          seed,
          random: search.get('random') === '1',
        }));
        return;
      }

      if (pathname === '/image') {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, ['GET']);
          return;
        }
        const src = search.get('src') ?? '';
        const cache = search.get('cache') === '1';
        const result = await wallhaven.image({ src, cache });
        if (!result.ok) {
          sendJson(res, result.status ?? 502, { ok: false, reason: result.reason });
          return;
        }
        const headers = {
          'content-type': result.contentType,
          // A wallhaven image URL always names the same bytes, so the browser
          // may keep it for as long as it likes. This is what makes the
          // background repaint instantly on reload instead of re-downloading a
          // 20 MB original.
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
        };
        if (typeof result.length === 'number') headers['content-length'] = String(result.length);
        res.writeHead(200, headers);
        result.stream.once('error', (error) => {
          logger?.warn?.(`${PKG}: 图片流中断：${error.message}`);
          res.destroy();
        });
        res.once('close', () => result.stream.destroy());
        result.stream.pipe(res);
        return;
      }

      if (pathname === '/download') {
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, ['POST']);
          return;
        }
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { ok: false, reason: '跨站请求被拒绝。' });
          return;
        }
        const body = await readJsonBody(req);
        if (typeof body !== 'object' || body === null) {
          sendJson(res, 400, { ok: false, reason: '请求体必须是 JSON 对象。' });
          return;
        }
        sendJson(res, 200, await wallhaven.download({ wallpaper: body['wallpaper'] }));
        return;
      }

      if (pathname === '/status') {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, ['GET']);
          return;
        }
        sendJson(res, 200, await statusPayload(search.get('probe') === '1'));
        return;
      }

      sendJson(res, 404, { ok: false, reason: `未知路由：${pathname}` });
    } catch (error) {
      // A body this plugin could not parse is the caller's problem, not a
      // server fault, and the two must not look the same from the page.
      const status = error.dshBodyError === true ? 400 : 500;
      logger?.warn?.(`${PKG}: 处理 ${pathname} 失败：${error.message}`);
      if (!res.headersSent) {
        sendJson(res, status, { ok: false, reason: error.message });
      } else {
        res.destroy();
      }
    }
  };
}

/**
 * The configuration the page receives on first paint, with secrets kept out of
 * the URL bar but available to the page itself.
 *
 * The API key is returned as stored: the page is the same origin the key is
 * used from, it is loopback-only in the shipped posture, and hiding it would
 * make the settings page unable to show what is configured. It is never logged,
 * never sent to wallhaven in a URL, and never placed in an image `src`.
 *
 * @param stored - the stored configuration.
 * @returns the configuration as sent to the page.
 */
export function configForClient(stored) {
  return normalizeConfig(stored, stored);
}
