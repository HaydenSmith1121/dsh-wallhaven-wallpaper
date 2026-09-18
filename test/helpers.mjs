/*
 * Test harness: a fake transport, a fake `http` request/response pair, and a
 * throwaway storage directory.
 *
 * The point of the fake transport is coverage without sockets: every failure a
 * real network produces — 401, 429, a dropped connection, a body that dies
 * halfway through an image — is a branch in the code under test, and all of
 * them are reachable here deterministically.
 */

import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Create a temp directory that the caller removes when finished. */
export async function makeTempDirectory(prefix = 'dsh-wh-test-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

/**
 * A transport whose answers are scripted per URL prefix.
 *
 * @param routes - `[{ match, status, headers, body } | { match, error }]`,
 *   consulted in order; `match` is a substring of the URL.
 * @returns `{ httpGet, httpReadText, calls }` suitable for `createWallhaven`.
 */
export function fakeTransport(routes) {
  const calls = [];
  const httpGet = async (url, options) => {
    calls.push({ url, options });
    for (const route of routes) {
      if (!url.includes(route.match)) continue;
      if (route.error !== undefined) throw new Error(route.error);
      const body = typeof route.body === 'string' ? Buffer.from(route.body, 'utf8') : route.body;
      return {
        status: route.status ?? 200,
        headers: route.headers ?? { 'content-type': 'application/json' },
        stream: Readable.from([body]),
        url,
      };
    }
    throw new Error(`fakeTransport: no route matched ${url}`);
  };
  const httpReadText = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  };
  return { httpGet, httpReadText, calls };
}

/**
 * A minimal `IncomingMessage`: headers, method, url, and an async body.
 *
 * @param input - `{ method, url, headers, body }`.
 * @returns a readable object the route handler accepts.
 */
export function fakeRequest(input) {
  const body = input.body === undefined
    ? []
    : [Buffer.from(typeof input.body === 'string' ? input.body : JSON.stringify(input.body), 'utf8')];
  const stream = Readable.from(body);
  return Object.assign(stream, {
    method: input.method ?? 'GET',
    url: input.url ?? '/',
    headers: input.headers ?? {},
  });
}

/**
 * A minimal `ServerResponse` that records what was written.
 *
 * A real `Writable`, because the image route `pipe`s into it: a hand-rolled
 * object with a `write` method would make the route fail on `emit` and the test
 * would be measuring the fake rather than the code.
 *
 * @returns `{ res, result }` where `result` is filled in as the handler runs.
 */
export function fakeResponse() {
  const result = { status: 0, headers: {}, chunks: [], ended: false, destroyed: false };
  const res = new Writable({
    write(chunk, _encoding, callback) {
      result.chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.headersSent = false;
  res.writeHead = function writeHead(status, headers) {
    result.status = status;
    result.headers = { ...headers };
    res.headersSent = true;
    return res;
  };
  const end = res.end.bind(res);
  res.end = function endWith(chunk, encoding, callback) {
    result.ended = true;
    return end(chunk, encoding, callback);
  };
  const destroy = res.destroy.bind(res);
  res.destroy = function destroyWith(error) {
    result.destroyed = true;
    result.ended = true;
    return destroy(error);
  };
  Object.defineProperty(result, 'text', {
    get: () => Buffer.concat(result.chunks).toString('utf8'),
  });
  Object.defineProperty(result, 'json', {
    get: () => JSON.parse(Buffer.concat(result.chunks).toString('utf8')),
  });
  return { res, result };
}

/** Wait for a response to be fully written, then return the recording. */
export async function runHandler(handler, request) {
  const { res, result } = fakeResponse();
  await handler(request, res);
  // A streamed response finishes after `pipe` drains; a destroyed one rejects
  // here, which is also a legitimate outcome the caller may assert on.
  await finished(res).catch(() => undefined);
  return result;
}

/**
 * A wallhaven search payload with `count` usable rows.
 *
 * @param count - how many rows to emit.
 * @param overrides - fields merged onto the meta block.
 * @returns a JSON string.
 */
export function searchPayload(count, overrides = {}) {
  const data = [];
  for (let index = 0; index < count; index += 1) {
    const id = `abc1${String(index).padStart(2, '0')}`;
    data.push({
      id,
      url: `https://wallhaven.cc/w/${id}`,
      short_url: `http://whvn.cc/${id}`,
      views: 10 + index,
      favorites: index,
      source: '',
      purity: 'sfw',
      category: 'general',
      dimension_x: 1920,
      dimension_y: 1080,
      resolution: '1920x1080',
      ratio: '1.78',
      file_size: 1234567,
      file_type: 'image/jpeg',
      created_at: '2024-01-01 00:00:00',
      colors: ['#000000', '#ffffff'],
      path: `https://w.wallhaven.cc/full/ab/wallhaven-${id}.jpg`,
      thumbs: {
        large: `https://th.wallhaven.cc/lg/ab/${id}.jpg`,
        original: `https://th.wallhaven.cc/orig/ab/${id}.jpg`,
        small: `https://th.wallhaven.cc/small/ab/${id}.jpg`,
      },
    });
  }
  return JSON.stringify({
    data,
    meta: { current_page: 1, last_page: 36, per_page: 24, total: 848, seed: null, ...overrides },
  });
}
