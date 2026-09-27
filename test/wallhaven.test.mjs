/*
 * The wallhaven client, driven entirely through a fake transport.
 *
 * Every one of these cases is a real answer wallhaven (or the network between
 * here and it) produces, and each must arrive at the page as a sentence rather
 * than as an exception nobody catches.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { createWallhaven } from '../src/host/wallhaven.js';
import { openConfigStore } from '../src/host/store.js';
import { fakeTransport, makeTempDirectory, searchPayload } from './helpers.mjs';

/** A store in a fresh temp home, already loaded. */
async function tempStore() {
  const temp = await makeTempDirectory();
  const store = openConfigStore({ dshHome: temp.directory });
  await store.load();
  return { temp, store };
}

test('search reports items, paging and the resolved proxy', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([
      { match: '/api/v1/search', body: searchPayload(3, { seed: 'aB3xY9' }) },
    ]);
    const wallhaven = createWallhaven({ store, env: { HTTPS_PROXY: 'http://proxy.test:8080' }, ...transport });
    const result = await wallhaven.search({ page: 2 });

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 3);
    assert.equal(result.total, 848);
    assert.equal(result.seed, 'aB3xY9');
    assert.equal(result.proxy, 'http://proxy.test:8080');
    assert.match(transport.calls[0].url, /page=2/);
    assert.match(transport.calls[0].url, /purity=100/);
  } finally {
    await temp.cleanup();
  }
});

test('search sends the API key as a header, never in the URL', async () => {
  const { temp, store } = await tempStore();
  try {
    await store.update({ apiKey: 'secret-key-value' });
    const transport = fakeTransport([{ match: '/api/v1/search', body: searchPayload(1) }]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    await wallhaven.search({ page: 1 });

    assert.equal(transport.calls[0].options.headers['x-api-key'], 'secret-key-value');
    assert.equal(transport.calls[0].url.includes('secret-key-value'), false);
  } finally {
    await temp.cleanup();
  }
});

test('a Cloudflare origin outage says so, and says it is not the proxy', async () => {
  const { temp, store } = await tempStore();
  try {
    // 521 is what wallhaven.cc actually served during a real origin outage, and
    // the symptom is indistinguishable from a broken proxy unless it is named.
    const transport = fakeTransport([{
      match: '/api/v1/search',
      status: 521,
      body: '<html><title>wallhaven.cc | 521: Web server is down</title></html>',
    }]);
    const wallhaven = createWallhaven({ store, env: { HTTPS_PROXY: 'http://proxy.test:8080' }, ...transport });
    const result = await wallhaven.search({ page: 1 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /521/);
    assert.match(result.reason, /源站已下线/);
    assert.match(result.reason, /与你的网络、代理地址都无关/);
    // The proxy really was fine, and the status still reports it as configured.
    assert.equal(result.proxy, 'http://proxy.test:8080');

    const probe = await wallhaven.probe();
    assert.equal(probe.ok, false);
    assert.match(probe.reason, /wallhaven 自己的故障/);
  } finally {
    await temp.cleanup();
  }
});

test('a plain 500 still reads as a wallhaven server error', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([{ match: '/api/v1/search', status: 503, body: '{}' }]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const result = await wallhaven.search({ page: 1 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /服务端错误（503）/);
  } finally {
    await temp.cleanup();
  }
});

test('a 401 explains that an API key is what is missing', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([
      { match: '/api/v1/search', status: 401, body: JSON.stringify({ message: 'Unauthorized' }) },
    ]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const result = await wallhaven.search({ page: 1 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /401/);
    assert.match(result.reason, /API Key/);
  } finally {
    await temp.cleanup();
  }
});

test('a 429 names the rate limit instead of reporting a generic failure', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([{ match: '/api/v1/search', status: 429, body: '{}' }]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const result = await wallhaven.search({ page: 1 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /45/);
  } finally {
    await temp.cleanup();
  }
});

test('a connect failure with no proxy in effect suggests configuring one', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([{ match: '/api/v1/search', error: 'connect ECONNREFUSED' }]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const result = await wallhaven.search({ page: 1 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /ECONNREFUSED/);
    assert.equal(result.proxy, '');
    assert.match(result.hint, /代理/);

    // With a proxy configured the same failure must not repeat the advice.
    await store.update({ proxy: 'http://127.0.0.1:7897' });
    const withProxy = await wallhaven.search({ page: 1 });
    assert.equal(withProxy.proxy, 'http://127.0.0.1:7897');
    assert.equal(withProxy.hint, '');
  } finally {
    await temp.cleanup();
  }
});

test('an unparseable body is reported, not rendered as zero results', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([{ match: '/api/v1/search', body: '<html>nope</html>' }]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const result = await wallhaven.search({ page: 1 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /无法解析/);
  } finally {
    await temp.cleanup();
  }
});

test('image refuses any URL outside the allowlist without opening a connection', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const result = await wallhaven.image({ src: 'https://evil.example/x.jpg', cache: false });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(transport.calls.length, 0);
  } finally {
    await temp.cleanup();
  }
});

test('image caches a thumbnail to disk and serves the second request from it', async () => {
  const { temp, store } = await tempStore();
  try {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const transport = fakeTransport([
      {
        match: 'th.wallhaven.cc',
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        body: bytes,
      },
    ]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const src = 'https://th.wallhaven.cc/small/ab/abc123.jpg';

    const first = await wallhaven.image({ src, cache: true });
    assert.equal(first.ok, true);
    assert.equal(first.cached, false);
    const firstBytes = [];
    for await (const chunk of first.stream) firstBytes.push(chunk);
    assert.deepEqual(Buffer.concat(firstBytes), bytes);

    const second = await wallhaven.image({ src, cache: true });
    assert.equal(second.ok, true);
    assert.equal(second.cached, true);
    assert.equal(second.length, bytes.length);
    assert.equal(transport.calls.length, 1, 'the second request must not hit the network');
    second.stream.resume();

    const cached = await readdir(wallhaven.cacheDirectory());
    assert.equal(cached.length, 1);
    assert.deepEqual(await readFile(join(wallhaven.cacheDirectory(), cached[0])), bytes);
  } finally {
    await temp.cleanup();
  }
});

test('image reports a non-200 source without leaking its body', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([{ match: 'th.wallhaven.cc', status: 404, body: 'gone' }]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const result = await wallhaven.image({
      src: 'https://th.wallhaven.cc/small/ab/missing.jpg',
      cache: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.match(result.reason, /404/);
  } finally {
    await temp.cleanup();
  }
});

test('download writes the original into the configured folder with a self-describing name', async () => {
  const { temp, store } = await tempStore();
  try {
    const bytes = Buffer.from('fake-image-bytes');
    const transport = fakeTransport([
      { match: 'w.wallhaven.cc', status: 200, headers: { 'content-type': 'image/jpeg' }, body: bytes },
    ]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const target = join(temp.directory, 'wallpapers');
    await store.update({ downloadDir: target });

    const wallpaper = {
      id: 'abc123',
      full: 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg',
      resolution: '3840x2160',
      fileType: 'image/jpeg',
    };

    const first = await wallhaven.download({ wallpaper });
    assert.equal(first.ok, true);
    assert.equal(first.fileName, 'wallhaven-abc123-3840x2160.jpg');
    assert.deepEqual(await readFile(first.path), bytes);

    // A second download of the same wallpaper must not overwrite the first.
    const second = await wallhaven.download({ wallpaper });
    assert.equal(second.ok, true);
    assert.equal(second.fileName, 'wallhaven-abc123-3840x2160-1.jpg');
  } finally {
    await temp.cleanup();
  }
});

test('download refuses a wallpaper whose original is not fetchable', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const result = await wallhaven.download({ wallpaper: { id: 'abc123', full: 'https://evil.example/x.jpg' } });
    assert.equal(result.ok, false);
    assert.equal(transport.calls.length, 0);
  } finally {
    await temp.cleanup();
  }
});

test('download reports a write failure instead of leaving a partial file behind', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([
      { match: 'w.wallhaven.cc', status: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('x') },
    ]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    // A file where the destination folder should be makes `mkdir` fail.
    const blocked = join(temp.directory, 'blocked');
    await (await import('node:fs/promises')).writeFile(blocked, 'not a directory', 'utf8');
    await store.update({ downloadDir: join(blocked, 'nested') });

    const result = await wallhaven.download({
      wallpaper: {
        id: 'abc123',
        full: 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg',
        resolution: '1920x1080',
        fileType: 'image/jpeg',
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /失败/);
  } finally {
    await temp.cleanup();
  }
});

test('probe reports reachability and latency on success', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([{ match: '/api/v1/search', body: searchPayload(1) }]);
    const wallhaven = createWallhaven({ store, env: { HTTPS_PROXY: 'http://proxy.test:8080' }, ...transport });
    const probe = await wallhaven.probe();
    assert.equal(probe.ok, true);
    assert.equal(typeof probe.latencyMs, 'number');
    assert.equal(probe.proxy, 'http://proxy.test:8080');
    assert.equal(probe.total, 848);
  } finally {
    await temp.cleanup();
  }
});

test('probe reports the reason on failure and never throws', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = fakeTransport([{ match: '/api/v1/search', error: 'getaddrinfo ENOTFOUND wallhaven.cc' }]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });
    const probe = await wallhaven.probe();
    assert.equal(probe.ok, false);
    assert.match(probe.reason, /ENOTFOUND/);
  } finally {
    await temp.cleanup();
  }
});

/* ── the connectivity test ────────────────────────────────────────────────── */

/**
 * A transport that answers by proxy rather than by URL.
 *
 * `diagnose` asks the same question through several routes in one call, so the
 * fake has to tell them apart the way the real transport would: by the proxy it
 * was handed.
 *
 * @param working - proxy URLs that should succeed; `''` means a direct route.
 * @param routes - the fake transport's scripted answers.
 * @returns a transport whose `calls` records the proxy per attempt.
 */
function proxyAwareTransport(working, routes) {
  const base = fakeTransport(routes);
  const calls = [];
  const httpGet = async (url, options) => {
    const proxy = options.proxy ?? '';
    calls.push({ url, proxy });
    if (!working.includes(proxy)) throw new Error(`连接 ${proxy === '' ? '直连' : proxy} 失败`);
    return base.httpGet(url, options);
  };
  return { httpGet, httpReadText: base.httpReadText, calls };
}

test('diagnose finds a working local proxy when nothing is configured', async () => {
  const { temp, store } = await tempStore();
  try {
    // Ports 7897 and 7890 are listening; only the second one actually reaches
    // wallhaven — which is exactly the case a port scan alone cannot decide.
    const transport = proxyAwareTransport(
      ['http://127.0.0.1:7890'],
      [{ match: '/api/v1/search', body: searchPayload(1) }],
    );
    const wallhaven = createWallhaven({
      store,
      env: {},
      findOpenPorts: async () => [7897, 7890],
      ...transport,
    });

    const result = await wallhaven.diagnose();
    // The *configured* route still fails — that is what `ok` answers, and it is
    // what the page's search gate reads. A found proxy is reported alongside.
    assert.equal(result.ok, false);
    assert.equal(result.source, 'discovered');
    assert.equal(result.proxy, '');
    assert.equal(result.discovered, 'http://127.0.0.1:7890');
    assert.equal(result.discovery.proxy, 'http://127.0.0.1:7890');
    assert.equal(typeof result.discovery.latencyMs, 'number');
    // Both open ports are reported, including the one that did not work: the
    // page shows the whole picture, not just the winner.
    assert.deepEqual(result.candidates.map((candidate) => candidate.proxy), ['http://127.0.0.1:7897', 'http://127.0.0.1:7890']);
    assert.deepEqual(result.candidates.map((candidate) => candidate.ok), [false, true]);
    assert.match(result.candidates[0].reason, /7897/);
  } finally {
    await temp.cleanup();
  }
});

test('diagnose reports a direct failure with no candidates when no port answers', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = proxyAwareTransport([], [{ match: '/api/v1/search', body: searchPayload(1) }]);
    const wallhaven = createWallhaven({ store, env: {}, findOpenPorts: async () => [], ...transport });

    const result = await wallhaven.diagnose();
    assert.equal(result.ok, false);
    assert.equal(result.source, 'direct');
    assert.equal(result.discovered, '');
    assert.equal(result.discovery, null);
    assert.deepEqual(result.candidates, []);
    // The scan still ran — it just had nothing to try.
    assert.equal(transport.calls.length, 1);
  } finally {
    await temp.cleanup();
  }
});

test('diagnose does not second-guess a proxy the user configured', async () => {
  const { temp, store } = await tempStore();
  try {
    await store.update({ proxy: 'http://127.0.0.1:9999' });
    const transport = proxyAwareTransport([], [{ match: '/api/v1/search', body: searchPayload(1) }]);
    let scanned = false;
    const wallhaven = createWallhaven({
      store,
      env: {},
      findOpenPorts: async () => {
        scanned = true;
        return [7890];
      },
      ...transport,
    });

    const result = await wallhaven.diagnose();
    assert.equal(result.ok, false);
    assert.equal(result.source, 'configured');
    // An explicit address is a decision, not a guess to be corrected.
    assert.equal(scanned, false);
    assert.deepEqual(result.candidates, []);
  } finally {
    await temp.cleanup();
  }
});

test('diagnose labels an environment proxy as configured, not direct', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = proxyAwareTransport([], [{ match: '/api/v1/search', body: searchPayload(1) }]);
    let scanned = false;
    const wallhaven = createWallhaven({
      store,
      env: { HTTPS_PROXY: 'http://proxy.test:8080' },
      findOpenPorts: async () => {
        scanned = true;
        return [];
      },
      ...transport,
    });

    const result = await wallhaven.diagnose();
    assert.equal(result.ok, false);
    assert.equal(result.source, 'configured');
    assert.equal(scanned, false);
  } finally {
    await temp.cleanup();
  }
});

test('diagnose succeeds straight away when the current route already works', async () => {
  const { temp, store } = await tempStore();
  try {
    const transport = proxyAwareTransport([''], [{ match: '/api/v1/search', body: searchPayload(2) }]);
    let scanned = false;
    const wallhaven = createWallhaven({
      store,
      env: {},
      findOpenPorts: async () => {
        scanned = true;
        return [7897];
      },
      ...transport,
    });

    const result = await wallhaven.diagnose();
    assert.equal(result.ok, true);
    assert.equal(result.source, 'direct');
    assert.equal(result.discovered, '');
    assert.equal(result.discovery, null);
    // Nothing is broken, so nothing is scanned.
    assert.equal(scanned, false);
    assert.equal(transport.calls.length, 1);
  } finally {
    await temp.cleanup();
  }
});

test('a random search overrides the saved sorting for that request only', async () => {
  const { temp, store } = await tempStore();
  try {
    await store.update({ sorting: 'toplist', topRange: '1M' });
    const transport = fakeTransport([{ match: '/api/v1/search', body: searchPayload(1) }]);
    const wallhaven = createWallhaven({ store, env: {}, ...transport });

    await wallhaven.search({ page: 1, random: true });
    assert.match(transport.calls[0].url, /sorting=random/);
    // `topRange` is only valid with `sorting=toplist`; leaving it on makes
    // wallhaven reject the whole request.
    assert.equal(transport.calls[0].url.includes('topRange'), false);
    // The saved configuration is untouched.
    assert.equal(store.get().sorting, 'toplist');
    assert.equal(store.get().topRange, '1M');
  } finally {
    await temp.cleanup();
  }
});
