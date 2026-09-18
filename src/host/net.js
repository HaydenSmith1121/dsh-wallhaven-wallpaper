/*
 * Proxy-aware HTTP for the host half.
 *
 * Why this exists instead of plain `fetch`: wallhaven.cc is unreachable on a
 * plain connection from a lot of networks — poisoned DNS, a filtered route, a
 * machine whose only way out is a local proxy client. Node's own `fetch` does
 * not read `HTTPS_PROXY` unless the process was started with an experimental
 * flag, and it cannot be given a per-plugin proxy at all. So this plugin speaks
 * `node:http`/`node:https` directly and tunnels through a proxy itself with the
 * one mechanism every HTTP proxy implements: `CONNECT`.
 *
 * No dependencies, and no SOCKS: an HTTP proxy port is what Clash/mihomo,
 * v2rayN, Surge and friends all expose, and it is the one this plugin can
 * support correctly rather than approximately.
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

/** Default ceiling for a JSON response we are willing to buffer (api payloads). */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/** Default wall clock budget for a request, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Pick the proxy to use: the explicit setting first, then the process
 * environment.
 *
 * The environment fallback matters because the person who had to configure a
 * proxy for DSH has almost certainly already exported it, and asking them to
 * type the same URL into a settings page is busywork.
 *
 * @param configured - the `proxy` value from this plugin's configuration.
 * @param env - the environment to read; injected so tests need no globals.
 * @returns a proxy URL string, or `''` for a direct connection.
 */
export function resolveProxyUrl(configured, env) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim();
  const source = env ?? process.env;
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * Normalize a proxy URL into `{ host, port }`, or throw with a usable message.
 *
 * @param proxyUrl - the proxy URL, e.g. `http://127.0.0.1:7897`.
 * @returns the endpoint to open a CONNECT tunnel to.
 */
export function parseProxy(proxyUrl) {
  let url;
  try {
    url = new URL(proxyUrl);
  } catch {
    throw new Error(`proxy URL 无法解析：${proxyUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只支持 http/https 代理，收到：${url.protocol}`);
  }
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`代理端口不合法：${proxyUrl}`);
  }
  return { host: url.hostname, port };
}

/**
 * Open a raw CONNECT tunnel through an HTTP proxy.
 *
 * @param proxy - `{ host, port }` of the proxy.
 * @param targetHost - the hostname the tunnel should reach.
 * @param targetPort - the port the tunnel should reach.
 * @param timeoutMs - how long to wait for the proxy's `200 Connection
 *   Established` before giving up.
 * @returns the tunnelled socket.
 */
function openTunnel(proxy, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const authority = `${targetHost}:${String(targetPort)}`;
    const request = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: authority,
      headers: { host: authority, 'proxy-connection': 'keep-alive' },
    });

    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(error);
    };

    request.setTimeout(timeoutMs, () => fail(new Error(`代理 ${proxy.host}:${String(proxy.port)} 建立隧道超时`)));
    request.once('error', (error) => fail(new Error(`代理连接失败：${error.message}`)));
    request.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`代理拒绝 CONNECT ${authority}：HTTP ${String(response.statusCode)}`));
        return;
      }
      settled = true;
      resolve(socket);
    });
    request.end();
  });
}

/**
 * Build an `https.Agent` whose sockets are CONNECT tunnels through `proxy`.
 *
 * One agent per proxy URL, cached by the caller: agents own sockets, and a
 * fresh one per request would open a tunnel per image.
 *
 * @param proxyUrl - the proxy URL.
 * @param timeoutMs - CONNECT timeout.
 * @returns an agent usable with `https.request`.
 */
function createTunnelAgent(proxyUrl, timeoutMs) {
  const proxy = parseProxy(proxyUrl);
  const agent = new https.Agent({ keepAlive: true, maxSockets: 6 });
  agent.createConnection = (options, callback) => {
    const targetHost = options.host;
    const targetPort = typeof options.port === 'number' ? options.port : 443;
    openTunnel(proxy, targetHost, targetPort, timeoutMs).then(
      (socket) => {
        const secure = tls.connect({
          socket,
          servername: options.servername ?? targetHost,
          // A tunnel socket has no lifetime of its own beyond the TLS session.
          rejectUnauthorized: options.rejectUnauthorized !== false,
        });
        secure.once('secureConnect', () => callback(null, secure));
        secure.once('error', (error) => callback(error));
      },
      (error) => callback(error),
    );
  };
  return agent;
}

/** Tunnels, keyed by proxy URL, so repeated requests reuse their connections. */
const tunnelAgents = new Map();

/**
 * The agent for a proxy URL, creating and memoizing the tunnel agent once.
 *
 * @param proxyUrl - the proxy URL.
 * @param timeoutMs - CONNECT timeout for a freshly built agent.
 * @returns the agent, or `undefined` for a direct connection.
 */
function agentFor(proxyUrl, timeoutMs) {
  if (proxyUrl === '') return undefined;
  const existing = tunnelAgents.get(proxyUrl);
  if (existing !== undefined) return existing;
  const agent = createTunnelAgent(proxyUrl, timeoutMs);
  tunnelAgents.set(proxyUrl, agent);
  return agent;
}

/** Drop every cached tunnel; called when the plugin is disposed. */
export function disposeAgents() {
  for (const agent of tunnelAgents.values()) agent.destroy();
  tunnelAgents.clear();
}

/**
 * Issue one GET and hand back the response stream.
 *
 * Redirects are followed (wallhaven serves images through a couple of hops
 * depending on the CDN edge), but only to the same allowlist the caller
 * enforces — the caller re-checks the final URL.
 *
 * @param url - the absolute https URL to fetch.
 * @param options - `{ proxy, headers, timeoutMs, maxRedirects }`.
 * @returns `{ status, headers, stream, url }`.
 */
export function get(url, options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const proxyUrl = typeof options.proxy === 'string' ? options.proxy : '';
  const maxRedirects = typeof options.maxRedirects === 'number' ? options.maxRedirects : 4;
  const headers = { 'user-agent': 'dsh-wallhaven-wallpaper/0.1 (+https://github.com/HaydenSmith1121)', ...options.headers };

  const attempt = (target, remaining) =>
    new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        reject(new Error(`不是合法 URL：${target}`));
        return;
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        reject(new Error(`不支持的协议：${parsed.protocol}`));
        return;
      }

      const isTls = parsed.protocol === 'https:';
      const transport = isTls ? https : http;
      const agent = isTls ? agentFor(proxyUrl, timeoutMs) : undefined;

      const request = transport.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port === '' ? (isTls ? 443 : 80) : Number(parsed.port),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          headers,
          agent,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && typeof response.headers.location === 'string') {
            response.resume();
            if (remaining <= 0) {
              reject(new Error('重定向次数过多'));
              return;
            }
            resolve(attempt(new URL(response.headers.location, target).toString(), remaining - 1));
            return;
          }
          resolve({ status, headers: response.headers, stream: response, url: target });
        },
      );

      request.setTimeout(timeoutMs, () => request.destroy(new Error(`请求超时（${String(timeoutMs)}ms）：${target}`)));
      request.once('error', reject);
      request.end();
    });

  return attempt(url, maxRedirects);
}

/**
 * Buffer a stream with a hard ceiling, so one huge or endless response cannot
 * exhaust the host process.
 *
 * @param stream - the readable stream.
 * @param maxBytes - the ceiling.
 * @returns the decoded UTF-8 body.
 */
export async function readText(stream, maxBytes = DEFAULT_MAX_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`响应超过 ${String(maxBytes)} 字节上限`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
