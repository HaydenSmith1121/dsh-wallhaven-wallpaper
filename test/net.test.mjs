/*
 * Proxy resolution: the piece that decides whether this plugin can reach
 * wallhaven at all on a network that needs one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseProxy, resolveProxyUrl } from '../src/host/net.js';

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
