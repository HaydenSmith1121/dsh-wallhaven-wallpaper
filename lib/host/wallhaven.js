/*
 * The wallhaven client, and the only place in this plugin that touches the
 * network.
 *
 * Two rules shape it:
 *
 *   1. **The host fetches, the page renders.** The browser is handed
 *      `/plugins/dsh-wallhaven-wallpaper/image?src=…` and never a wallhaven
 *      URL, so a page that cannot reach wallhaven — blocked DNS, no proxy for
 *      the browser, a locked-down network — still shows wallpapers, because the
 *      only process that needs egress is this one.
 *   2. **Nothing is fetched that was not allowlisted.** Every `src` is checked
 *      with `isAllowedImageUrl` before a socket is opened, so the image route
 *      cannot be turned into an open relay by a crafted link.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  API_BASE,
  LOCAL_PROXY_PORTS,
  PKG,
  buildSearchParams,
  isAllowedImageUrl,
  normalizeWallpaper,
  parseSearchResponse,
} from '../shared/constants.js';
import { findOpenPorts as findOpenPortsDefault, get, readText, resolveProxyUrl } from './net.js';

/** How many cached thumbnails to keep before pruning the oldest. */
const CACHE_MAX_FILES = 400;

/** How many bytes of cached thumbnails to keep before pruning the oldest. */
const CACHE_MAX_BYTES = 256 * 1024 * 1024;

/** How long a single image fetch may take, in milliseconds. */
const IMAGE_TIMEOUT_MS = 45000;

/** Wall clock budget for one ordinary API request, in milliseconds. */
const API_TIMEOUT_MS = 20000;

/**
 * Budget for a *connectivity test*, in milliseconds.
 *
 * Deliberately much shorter than {@link API_TIMEOUT_MS}. A test that takes
 * twenty seconds to say "no" is not a test — it is the same wait the user was
 * already stuck with, just labelled differently. Eight seconds is long enough
 * for a slow proxy to complete a real API round trip and short enough that
 * pressing the button feels like pressing a button.
 */
const PROBE_TIMEOUT_MS = 8000;

/** Budget for one discovery attempt through a candidate loopback port. */
const DISCOVERY_TIMEOUT_MS = 5000;

/** How many open candidate ports to actually test through. */
const DISCOVERY_MAX_ATTEMPTS = 4;

/**
 * Cloudflare's "my origin is not answering" statuses.
 *
 * These are the one class of failure where the honest answer is "nothing on
 * your side is wrong" — worth naming, because the symptom looks exactly like a
 * broken proxy and the fix people reach for (retyping the proxy address) cannot
 * possibly help.
 */
const CLOUDFLARE_ORIGIN_ERRORS = {
  520: '源站返回未知错误',
  521: '源站已下线',
  522: '连接源站超时',
  523: '源站不可达',
  524: '源站响应超时',
  525: '与源站 SSL 握手失败',
  526: '源站证书无效',
  527: 'Railgun 出错',
};

/**
 * The extension a saved file should carry.
 *
 * The URL's own extension wins: wallhaven names the original file there, and it
 * is the only field that cannot disagree with the bytes.
 *
 * @param fileType - wallhaven's `file_type`, a MIME type.
 * @param url - the image URL.
 * @returns an extension without the dot.
 */
function extensionFor(fileType, url) {
  try {
    const fromUrl = extname(new URL(url).pathname).replace('.', '').toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(fromUrl)) return fromUrl;
  } catch {
    /* Fall through to the MIME mapping. */
  }
  if (fileType === 'image/png') return 'png';
  if (fileType === 'image/webp') return 'webp';
  if (fileType === 'image/gif') return 'gif';
  return 'jpg';
}

/** Guess a content type from a file's extension. */
function contentTypeFor(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * Strip everything a filesystem would object to out of one path segment.
 *
 * @param value - the candidate segment.
 * @returns a segment safe to join onto a directory.
 */
function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
}

/**
 * The folder originals are saved into when the configuration names none.
 *
 * @returns the default directory's absolute path.
 */
export function defaultDownloadDirectory() {
  return join(homedir(), 'Pictures', 'DSH Wallpapers');
}

/** The cache file holding one source URL. */
function cachePath(directory, src) {
  const digest = createHash('sha256').update(src).digest('hex').slice(0, 32);
  return join(directory, `${digest}.${extensionFor('', src)}`);
}

/** Read a cached entry's metadata, or `null` when it is not there. */
async function readCache(directory, src) {
  const path = cachePath(directory, src);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return null;
    return { path, size: info.size, contentType: contentTypeFor(path) };
  } catch {
    return null;
  }
}

/**
 * Keep the thumbnail cache bounded: oldest files go first once either ceiling
 * is crossed. Best-effort — a cache that cannot be pruned is still a cache.
 *
 * @param directory - the cache directory.
 * @param logger - optional warning sink.
 */
async function pruneCache(directory, logger) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }
  const files = [];
  let total = 0;
  for (const entry of entries) {
    const path = join(directory, entry);
    if (entry.endsWith('.part')) {
      await unlink(path).catch(() => undefined);
      continue;
    }
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      files.push({ path, size: info.size, mtime: info.mtimeMs });
      total += info.size;
    } catch {
      /* Raced with another prune; skip it. */
    }
  }
  if (files.length <= CACHE_MAX_FILES && total <= CACHE_MAX_BYTES) return;
  files.sort((left, right) => left.mtime - right.mtime);
  let remaining = files.length;
  for (const file of files) {
    if (remaining <= CACHE_MAX_FILES && total <= CACHE_MAX_BYTES) break;
    try {
      await unlink(file.path);
      total -= file.size;
      remaining -= 1;
    } catch (error) {
      logger?.warn?.(`${PKG}: 清理缩略图缓存失败：${error.message}`);
    }
  }
}

/**
 * A path inside `directory` that does not exist yet.
 *
 * @param directory - the target directory.
 * @param fileName - the preferred name.
 * @returns an absolute path that is free to write.
 */
async function freePath(directory, fileName) {
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  let candidate = join(directory, fileName);
  let counter = 1;
  for (;;) {
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
    candidate = join(directory, `${stem}-${String(counter)}${extension}`);
    counter += 1;
    if (counter > 9999) return join(directory, `${stem}-${String(Date.now())}${extension}`);
  }
}

/**
 * Build the wallhaven client bound to one configuration store.
 *
 * @param options - `{ store, logger, env, httpGet, httpReadText, findOpenPorts,
 *   localProxyPorts }`. The transport hooks exist so tests can drive every
 *   branch — a 401, a 429, a dead proxy, a stream that dies mid-image — without
 *   a socket, and the two discovery hooks exist for the same reason: a test
 *   cannot rely on which loopback ports happen to be listening. They default to
 *   the real implementations, and nothing else in this file knows they are
 *   replaceable.
 * @returns the client's operations, all returning plain JSON-safe objects.
 */
export function createWallhaven(options) {
  const store = options.store;
  const logger = options.logger;
  const env = options.env;
  const httpGet = options.httpGet ?? get;
  const httpReadText = options.httpReadText ?? readText;
  const findOpenPorts = options.findOpenPorts ?? findOpenPortsDefault;
  const candidatePorts = options.localProxyPorts ?? LOCAL_PROXY_PORTS;
  const cacheDirectory = join(store.describe().directory, 'cache');

  /** The proxy actually in effect for the current configuration. */
  function proxyNow() {
    return resolveProxyUrl(store.get().proxy, env);
  }

  /**
   * Issue one API request against wallhaven's v1 API.
   *
   * @param path - the API path, e.g. `/search`.
   * @param params - query parameters.
   * @param options - `{ proxy, timeoutMs }`; both default to the configured
   *   route and {@link API_TIMEOUT_MS}. The connectivity test overrides them so
   *   it can try a candidate proxy without touching the stored configuration.
   * @returns `{ status, body }` with the decoded JSON body when parseable.
   */
  async function apiRequest(path, params, options = {}) {
    const config = store.get();
    const query = params.toString();
    const url = `${API_BASE}${path}${query === '' ? '' : `?${query}`}`;
    const headers = { accept: 'application/json' };
    // The key travels as a header, not a query parameter: query strings end up
    // in proxy logs and error messages, headers do not.
    if (config.apiKey !== '') headers['x-api-key'] = config.apiKey;

    const proxy = typeof options.proxy === 'string' ? options.proxy : proxyNow();
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : API_TIMEOUT_MS;
    const response = await httpGet(url, { proxy, headers, timeoutMs });
    const text = await httpReadText(response.stream);
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  /**
   * One connectivity test through a given route.
   *
   * Runs a real search rather than a bare TCP connect, because "the port is
   * open" and "wallhaven answers through it" are different facts and only the
   * second one is what the user is asking about.
   *
   * @param proxy - the proxy URL to test; `''` for a direct connection.
   * @param timeoutMs - the budget.
   * @returns `{ ok, latencyMs, reason, proxy, total }`.
   */
  async function probeThrough(proxy, timeoutMs) {
    const params = new URLSearchParams({ purity: '100', categories: '111', page: '1' });
    const startedAt = Date.now();
    try {
      const response = await apiRequest('/search', params, { proxy, timeoutMs });
      const latencyMs = Date.now() - startedAt;
      if (response.status !== 200) {
        return { ok: false, latencyMs, reason: explainApiFailure(response.status, response.body), proxy, total: 0 };
      }
      const parsed = parseSearchResponse(response.body);
      return {
        ok: parsed !== null,
        latencyMs,
        reason: parsed === null ? '响应无法解析。' : '',
        proxy,
        total: parsed === null ? 0 : parsed.total,
      };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, reason: error.message, proxy, total: 0 };
    }
  }

  /**
   * Turn wallhaven's error payload into one sentence a person can act on.
   *
   * @param status - the HTTP status.
   * @param body - the decoded body, when there was one.
   * @returns a human-readable reason.
   */
  function explainApiFailure(status, body) {
    const message = typeof body === 'object' && body !== null && typeof body['message'] === 'string'
      ? body['message']
      : '';
    if (status === 401) {
      return 'wallhaven 拒绝了这次请求（401）：sketchy / nsfw 或账号相关内容需要 API Key，请在「访问」里填写。';
    }
    if (status === 429) {
      return 'wallhaven 限流（429）：API 每分钟上限 45 次，请稍后再试。';
    }
    // Cloudflare's 52x family is emitted when Cloudflare itself is up but
    // cannot reach wallhaven's origin. Saying so explicitly is worth the extra
    // sentence: the plain "服务端错误" reads like a local misconfiguration, and
    // the natural next move — fiddling with the proxy address — cannot help.
    const cloudflare = CLOUDFLARE_ORIGIN_ERRORS[status];
    if (cloudflare !== undefined) {
      return `wallhaven 的源站当前不可用（Cloudflare ${String(status)}：${cloudflare}）—— 这是 wallhaven 自己的故障，`
        + '与你的网络、代理地址都无关，过一会儿再试即可。';
    }
    if (status >= 500) {
      return `wallhaven 服务端错误（${String(status)}）${message === '' ? '' : `：${message}`}，稍后重试。`;
    }
    return `wallhaven 返回 HTTP ${String(status)}${message === '' ? '' : `：${message}`}`;
  }

  return {
    /** The proxy this plugin would use right now, for the status line. */
    proxyInEffect() {
      return proxyNow();
    },

    /** Where the thumbnail cache lives. */
    cacheDirectory() {
      return cacheDirectory;
    },

    /**
     * Run one search and hand the page everything it needs to draw a grid.
     *
     * @param input - `{ page, seed, random }`. `random` overrides the saved
     *   sorting for this request only, which is what the sidebar's "换一张"
     *   action needs: it must not rewrite the user's chosen sorting to work.
     * @returns the wire result; `ok: false` carries a reason, never a throw.
     */
    async search(input) {
      const config = store.get();
      const page = typeof input.page === 'number' && Number.isFinite(input.page) ? input.page : 1;
      const seed = typeof input.seed === 'string' ? input.seed : '';
      const params = buildSearchParams(config, page, seed);
      if (input.random === true) {
        params.set('sorting', 'random');
        // `topRange` is only meaningful with `sorting=toplist`; leaving it set
        // makes wallhaven reject the request.
        params.delete('topRange');
      }

      let response;
      try {
        response = await apiRequest('/search', params);
      } catch (error) {
        return {
          ok: false,
          reason: `连不上 wallhaven：${error.message}`,
          proxy: proxyNow(),
          hint: proxyNow() === ''
            ? '本机没有可用代理。如果你的网络需要代理才能访问 wallhaven，请在「访问」里填上代理地址。'
            : '',
        };
      }

      if (response.status !== 200) {
        return { ok: false, reason: explainApiFailure(response.status, response.body), proxy: proxyNow(), hint: '' };
      }
      const parsed = parseSearchResponse(response.body);
      if (parsed === null) {
        return { ok: false, reason: 'wallhaven 返回的搜索结果无法解析。', proxy: proxyNow(), hint: '' };
      }

      return {
        ok: true,
        ...parsed,
        requestUrl: `${API_BASE}/search?${params.toString()}`,
        proxy: proxyNow(),
      };
    },

    /**
     * Fetch one image, optionally from the on-disk cache.
     *
     * @param input - `{ src, cache }`.
     * @returns `{ ok: true, contentType, stream, length }` or `{ ok: false }`.
     */
    async image(input) {
      const src = input.src;
      if (!isAllowedImageUrl(src)) {
        return { ok: false, status: 400, reason: '只允许代理 wallhaven 的图片地址。' };
      }

      if (input.cache === true) {
        const cached = await readCache(cacheDirectory, src);
        if (cached !== null) {
          return {
            ok: true,
            status: 200,
            contentType: cached.contentType,
            stream: createReadStream(cached.path),
            length: cached.size,
            cached: true,
          };
        }
      }

      /** Fetch once, buffering into the cache when asked to. */
      const fetchOnce = async () => {
        const response = await httpGet(src, {
          proxy: proxyNow(),
          timeoutMs: IMAGE_TIMEOUT_MS,
          headers: { accept: 'image/*' },
        });
        if (response.status !== 200) {
          response.stream.resume();
          throw new Error(`图片源返回 HTTP ${String(response.status)}`);
        }
        return response;
      };

      let response;
      try {
        response = await fetchOnce();
      } catch (error) {
        return { ok: false, status: 502, reason: `图片下载失败：${error.message}` };
      }

      const contentType = response.headers['content-type'] ?? contentTypeFor(src);
      if (input.cache !== true) {
        return { ok: true, status: 200, contentType, stream: response.stream, length: undefined, cached: false };
      }

      // Cache path: buffer through a temp file, serve from the file just
      // written, then move it into place. A cache write failure must never cost
      // the user their thumbnail, so every step falls back to a plain refetch.
      try {
        await mkdir(cacheDirectory, { recursive: true });
        const target = cachePath(cacheDirectory, src);
        const temporary = `${target}.part`;
        await pipeline(response.stream, createWriteStream(temporary));
        const info = await stat(temporary);
        await rename(temporary, target);
        pruneCache(cacheDirectory, logger).catch(() => undefined);
        return {
          ok: true,
          status: 200,
          contentType,
          stream: createReadStream(target),
          length: info.size,
          cached: false,
        };
      } catch (error) {
        logger?.warn?.(`${PKG}: 缩略图缓存写入失败（不影响显示）：${error.message}`);
        try {
          const retry = await fetchOnce();
          return { ok: true, status: 200, contentType, stream: retry.stream, length: undefined, cached: false };
        } catch (retryError) {
          return { ok: false, status: 502, reason: `图片下载失败：${retryError.message}` };
        }
      }
    },

    /**
     * Save one original into the configured folder.
     *
     * @param input - `{ wallpaper }`, the record to download.
     * @returns `{ ok, path, bytes, directory }`, or `ok: false` with a reason.
     */
    async download(input) {
      const record = normalizeWallpaper(input.wallpaper);
      if (record === null) return { ok: false, reason: '这张壁纸的原始地址不合法，无法下载。' };

      const config = store.get();
      const directory = config.downloadDir === '' ? defaultDownloadDirectory() : config.downloadDir;
      const extension = extensionFor(record.fileType, record.full);
      const resolution = safeSegment(record.resolution === '' ? 'original' : record.resolution);

      let response;
      try {
        response = await httpGet(record.full, {
          proxy: proxyNow(),
          timeoutMs: IMAGE_TIMEOUT_MS,
          headers: { accept: 'image/*' },
        });
      } catch (error) {
        return { ok: false, reason: `下载失败：${error.message}` };
      }
      if (response.status !== 200) {
        response.stream.resume();
        return { ok: false, reason: `下载失败：图片源返回 HTTP ${String(response.status)}` };
      }

      let target;
      try {
        await mkdir(directory, { recursive: true });
        target = await freePath(directory, `wallhaven-${safeSegment(record.id)}-${resolution}.${extension}`);
        await pipeline(response.stream, createWriteStream(`${target}.part`));
        await rename(`${target}.part`, target);
        const info = await stat(target);
        return { ok: true, path: target, directory, bytes: info.size, fileName: basename(target) };
      } catch (error) {
        response.stream.destroy();
        if (typeof target === 'string') await unlink(`${target}.part`).catch(() => undefined);
        return { ok: false, reason: `写入 ${directory} 失败：${error.message}` };
      }
    },

    /**
     * Report whether wallhaven is actually reachable with the current settings.
     *
     * The page's status line uses this so "nothing came back" arrives with a
     * diagnosis attached, instead of leaving the user to guess between a bad
     * query, a missing key and a dead proxy.
     *
     * @returns `{ ok, latencyMs, reason, proxy, total }`.
     */
    async probe() {
      return probeThrough(proxyNow(), PROBE_TIMEOUT_MS);
    },

    /**
     * The connectivity test the settings page gates its searches on.
     *
     * Tests the route that is in effect, and — only when the user has not named
     * a proxy themselves — looks for a local proxy client that wallhaven is
     * actually reachable through.
     *
     * ◆ Why discovery exists
     *   The commonest "wallhaven 连不上" is not a broken network. It is a
     *   machine whose only egress is a local proxy client (Clash/mihomo, v2rayN,
     *   Surge) plus a DSH launched from a GUI, which therefore never inherited
     *   `HTTPS_PROXY`. The plugin then dials a DNS-poisoned host directly and
     *   waits out the timeout. Naming the port it found turns that into one
     *   click.
     *
     * ◆ Why it is skipped once a proxy is configured
     *   If the user typed an address, "that address does not work" is the useful
     *   answer. Offering a different one would be second-guessing an explicit
     *   choice, and on a corporate network a discovered loopback port is far
     *   more likely to be somebody's dev server than a way out.
     *
     * @returns `{ ok, latencyMs, reason, proxy, total, source, candidates,
     *   discovered }`, where `source` is `'direct'`, `'configured'`, or
     *   `'discovered'`, and `candidates` lists what each open loopback port
     *   answered.
     */
    async diagnose() {
      const current = proxyNow();
      const first = await probeThrough(current, PROBE_TIMEOUT_MS);
      // `direct` is the honest label for an empty route whether it came from an
      // empty setting or an empty environment.
      const source = current === '' ? 'direct' : 'configured';
      if (first.ok) return { ...first, source, candidates: [], discovered: '', discovery: null };
      // A proxy is already named — by the user or by the environment. "That
      // address does not work" is the useful answer, and on a managed network a
      // discovered loopback port is far likelier to be somebody's dev server
      // than a way out.
      if (current !== '') return { ...first, source, candidates: [], discovered: '', discovery: null };

      const open = await findOpenPorts(candidatePorts);
      const attempts = open
        .map((port) => `http://127.0.0.1:${String(port)}`)
        .slice(0, DISCOVERY_MAX_ATTEMPTS);

      // Concurrent, and bounded by DISCOVERY_TIMEOUT_MS rather than by the sum
      // of the attempts: a scan that takes four times as long as one attempt is
      // a scan nobody waits for.
      const results = await Promise.all(attempts.map((url) => probeThrough(url, DISCOVERY_TIMEOUT_MS)));
      const candidates = results.map((result) => ({
        proxy: result.proxy,
        ok: result.ok,
        latencyMs: result.latencyMs,
        reason: result.ok ? '' : result.reason,
      }));

      const winner = results.find((result) => result.ok);
      if (winner === undefined) return { ...first, source, candidates, discovered: '', discovery: null };

      // ◆ The primary fields stay the *current route's* answer.
      //   "Is what I have configured working?" is the question the status line
      //   asks and the question the search gate must answer, and a proxy that
      //   was merely found is not in effect yet. Reporting the winner here would
      //   make an unreachable configuration read as reachable and let a search
      //   through that then hangs on the same dead route. The find is reported
      //   alongside, never instead.
      return {
        ...first,
        source: 'discovered',
        candidates,
        discovered: winner.proxy,
        discovery: { proxy: winner.proxy, latencyMs: winner.latencyMs, total: winner.total },
      };
    },
  };
}
