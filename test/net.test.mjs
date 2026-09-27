/*
 * Proxy resolution: the piece that decides whether this plugin can reach
 * wallhaven at all on a network that needs one.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { findOpenPorts, isPortOpen, parseProxy, resolveProxyUrl } from '../src/host/net.js';

test('an explicit proxy wins over the environment', () => {
  assert.equal(
    resolveProxyUrl('http://explicit.test:1234', { HTTPS_PROXY: 'http://env.test:9999' }),
    'http://explicit.test:1234',
  );
});

test('the environment is consulted in a stable, documented order', () => {
  assert.equal(resolveProxyUrl('', { HTTPS_PROXY: 'http://a.test:1' }), 'http://a.test:1');
  assert.equal(resolveProxyUrl('', { https_proxy: 'http://b.test:2' }), 'http://b.test:2');
  assert.equal(resolveProxyUrl('', { ALL_PROXY: 'http://c.test:3' }), 'http://c.test:3');
  assert.equal(
    resolveProxyUrl('', { HTTPS_PROXY: 'http://a.test:1', ALL_PROXY: 'http://c.test:3' }),
    'http://a.test:1',
  );
  assert.equal(resolveProxyUrl('', {}), '');
});

test('an empty or blank explicit setting falls through to the environment', () => {
  assert.equal(resolveProxyUrl('   ', { HTTPS_PROXY: 'http://a.test:1' }), 'http://a.test:1');
  assert.equal(resolveProxyUrl(undefined, { HTTPS_PROXY: 'http://a.test:1' }), 'http://a.test:1');
  assert.equal(resolveProxyUrl('', { HTTPS_PROXY: '  ' }), '');
});

test('parseProxy fills in the scheme default port', () => {
  assert.deepEqual(parseProxy('http://127.0.0.1:7897'), { host: '127.0.0.1', port: 7897 });
  assert.deepEqual(parseProxy('http://proxy.test'), { host: 'proxy.test', port: 80 });
  assert.deepEqual(parseProxy('https://proxy.test'), { host: 'proxy.test', port: 443 });
});

test('parseProxy refuses the shapes it cannot tunnel', () => {
  assert.throws(() => parseProxy('socks5://127.0.0.1:1080'), /只支持/);
  assert.throws(() => parseProxy('not a url'), /无法解析/);
});

/* ── loopback port discovery ──────────────────────────────────────────────── */

/** Run `body` with a real listener on an OS-assigned port, then close it. */
async function withListeningServer(body) {
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await body(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('isPortOpen distinguishes a listening port from a closed one', async () => {
  await withListeningServer(async (port) => {
    assert.equal(await isPortOpen('127.0.0.1', port), true);
  });
  // The listener is closed by now, so the same port must read as closed. This
  // is the property the whole scan rests on: "no proxy client running" has to
  // be distinguishable from "a proxy client that did not answer".
  assert.equal(await isPortOpen('127.0.0.1', 1, 300), false);
});

test('findOpenPorts keeps the caller ordering and drops the closed ones', async () => {
  await withListeningServer(async (port) => {
    const open = await findOpenPorts([1, port, 2]);
    assert.deepEqual(open, [port]);
  });
});

test('findOpenPorts answers an empty list without touching the network', async () => {
  assert.deepEqual(await findOpenPorts([]), []);
});
