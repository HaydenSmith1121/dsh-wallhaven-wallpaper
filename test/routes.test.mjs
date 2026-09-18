/*
 * The route layer: what the settings page can and cannot make the host do.
 *
 * Two of these are load-bearing beyond "does it work": the cross-origin refusal
 * on the two writing routes, and the fact that `/image` will not fetch a URL
 * outside the allowlist. Both are the reason this plugin can be handed a
 * `src` from a page without becoming an open relay.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROUTE_BASE } from '../src/shared/constants.js';
import { createRouteHandler } from '../src/host/routes.js';
import { createWallhaven } from '../src/host/wallhaven.js';
import { openConfigStore } from '../src/host/store.js';
import {
  fakeRequest,
  fakeTransport,
  makeTempDirectory,
  runHandler,
  searchPayload,
} from './helpers.mjs';

/**
 * Wire a handler onto a fresh temp store and a scripted transport.
 *
 * @param routes - the fake transport's scripted answers.
 * @param patch - configuration applied before the first request.
 */
async function harness(routes, patch = {}, options = {}) {
  const temp = await makeTempDirectory();
  const store = openConfigStore({ dshHome: temp.directory });
  await store.load();
  if (Object.keys(patch).length > 0) await store.update(patch);
  const transport = fakeTransport(routes);
  const wallhaven = createWallhaven({ store, env: options.env ?? {}, ...transport });
  const handler = createRouteHandler({
    store,
    wallhaven,
    logger: undefined,
    ready: options.ready,
  });
  return {
    store,
    transport,
    handler,
    cleanup: temp.cleanup,
    /** The temp `$DSH_HOME`, for tests that need a writable download folder. */
    home: temp.directory,
    get: (path) => runHandler(handler, fakeRequest({ method: 'GET', url: `${ROUTE_BASE}${path}`, headers: { host: '127.0.0.1:43120' } })),
    post: (path, body, headers = {}) => runHandler(handler, fakeRequest({
      method: 'POST',
      url: `${ROUTE_BASE}${path}`,
      headers: { host: '127.0.0.1:43120', 'content-type': 'application/json', ...headers },
      body,
    })),
  };
}

test('GET /config returns the whole configuration', async () => {
  const ctx = await harness([], { query: 'mountains' });
  try {
    const result = await ctx.get('/config');
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.config.query, 'mountains');
    assert.equal(result.json.config.purity, '100');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /config validates through the store and answers with the stored value', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.post('/config', { patch: { purity: '011', blur: 9999 } });
    assert.equal(result.status, 200);
    // SFW is forced back on and the blur is clamped: the page is told what was
    // actually stored, not what it asked for.
    assert.equal(result.json.config.purity, '111');
    assert.equal(result.json.config.blur, 60);
    assert.equal(ctx.store.get().purity, '111');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /config accepts a bare configuration object as well as a patch envelope', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.post('/config', { query: 'forest' });
    assert.equal(result.json.config.query, 'forest');
  } finally {
    await ctx.cleanup();
  }
});

test('a cross-origin POST is refused, so a visited page cannot rewrite the proxy', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.post('/config', { patch: { proxy: 'http://attacker.test:1' } }, { origin: 'https://evil.example' });
    assert.equal(result.status, 403);
    assert.equal(ctx.store.get().proxy, '');
  } finally {
    await ctx.cleanup();
  }
});

test('a same-origin POST is allowed', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.post(
      '/config',
      { patch: { query: 'ok' } },
      { origin: 'http://127.0.0.1:43120' },
    );
    assert.equal(result.status, 200);
    assert.equal(result.json.config.query, 'ok');
  } finally {
    await ctx.cleanup();
  }
});

test('a cross-origin download is refused too', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.post(
      '/download',
      { wallpaper: { id: 'abc123', full: 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg' } },
      { origin: 'https://evil.example' },
    );
    assert.equal(result.status, 403);
    assert.equal(ctx.transport.calls.length, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('a malformed JSON body is a 400 with a reason, not a crash', async () => {
  const ctx = await harness([]);
  try {
    const result = await runHandler(ctx.handler, fakeRequest({
      method: 'POST',
      url: `${ROUTE_BASE}/config`,
      headers: { host: '127.0.0.1:43120' },
      body: '{ not json',
    }));
    assert.equal(result.status, 400);
    assert.match(result.json.reason, /JSON/);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /search proxies a search and passes the random flag through', async () => {
  const ctx = await harness([{ match: '/api/v1/search', body: searchPayload(2) }]);
  try {
    const result = await ctx.get('/search?page=3&random=1');
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.items.length, 2);
    assert.match(ctx.transport.calls[0].url, /sorting=random/);
    assert.match(ctx.transport.calls[0].url, /page=3/);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /image streams wallhaven bytes with an immutable cache header', async () => {
  const ctx = await harness([
    { match: 'th.wallhaven.cc', status: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.from([1, 2, 3, 4, 5]) },
  ]);
  try {
    const src = encodeURIComponent('https://th.wallhaven.cc/small/ab/abc123.jpg');
    const result = await ctx.get(`/image?src=${src}&cache=1`);
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], 'image/jpeg');
    assert.match(result.headers['cache-control'], /immutable/);
    assert.equal(result.headers['content-length'], '5');
    assert.deepEqual(Buffer.concat(result.chunks), Buffer.from([1, 2, 3, 4, 5]));
  } finally {
    await ctx.cleanup();
  }
});

test('GET /image refuses a src outside the allowlist and never opens a connection', async () => {
  const ctx = await harness([]);
  try {
    const src = encodeURIComponent('https://evil.example/x.jpg');
    const result = await ctx.get(`/image?src=${src}`);
    assert.equal(result.status, 400);
    assert.equal(ctx.transport.calls.length, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /image without a src is refused rather than fetching something arbitrary', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.get('/image');
    assert.equal(result.status, 400);
    assert.equal(ctx.transport.calls.length, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /download saves the original and reports where it went', async () => {
  const ctx = await harness([
    { match: 'w.wallhaven.cc', status: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('bytes') },
  ]);
  try {
    // The default download folder is the user's Pictures directory, which a
    // test has no business writing to.
    await ctx.store.update({ downloadDir: join(ctx.home, 'wallpapers') });
    const result = await ctx.post('/download', {
      wallpaper: {
        id: 'abc123',
        full: 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg',
        resolution: '1920x1080',
        fileType: 'image/jpeg',
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.match(result.json.path, /wallhaven-abc123-1920x1080\.jpg$/);
    assert.deepEqual(await readFile(result.json.path), Buffer.from('bytes'));
  } finally {
    await ctx.cleanup();
  }
});

test('POST /download with nothing usable is a clear failure', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.post('/download', { wallpaper: { id: 'abc123', full: 'https://evil.example/x.jpg' } });
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, false);
    assert.equal(ctx.transport.calls.length, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /status describes the paths and the proxy without probing by default', async () => {
  const ctx = await harness([], { proxy: 'http://127.0.0.1:7897' });
  try {
    const result = await ctx.get('/status');
    assert.equal(result.status, 200);
    assert.equal(result.json.proxy, 'http://127.0.0.1:7897');
    assert.equal(result.json.probe, null);
    assert.match(result.json.configFile, /config\.json$/);
    assert.match(result.json.downloadDirectory, /DSH Wallpapers$/);
    assert.equal(ctx.transport.calls.length, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /status?probe=1 actually reaches wallhaven', async () => {
  const ctx = await harness([{ match: '/api/v1/search', body: searchPayload(1) }]);
  try {
    const result = await ctx.get('/status?probe=1');
    assert.equal(result.json.probe.ok, true);
    assert.equal(ctx.transport.calls.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('an unknown sub-path is a JSON 404, not the SPA fallback', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.get('/nope');
    assert.equal(result.status, 404);
    assert.equal(result.json.ok, false);
  } finally {
    await ctx.cleanup();
  }
});

test('a wrong method is a 405 that names the right one', async () => {
  const ctx = await harness([]);
  try {
    const result = await ctx.post('/search', {});
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, 'GET');
  } finally {
    await ctx.cleanup();
  }
});

test('every request waits for the first configuration load', async () => {
  let released = false;
  let release;
  const gate = new Promise((resolve) => {
    release = () => {
      released = true;
      resolve();
    };
  });
  const ctx = await harness([], { query: 'wildlife' }, { ready: gate });
  try {
    const pending = ctx.get('/config');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(released, false, 'the handler must not answer before the store is loaded');
    release();
    const result = await pending;
    assert.equal(result.json.config.query, 'wildlife');
  } finally {
    await ctx.cleanup();
  }
});
