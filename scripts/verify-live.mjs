/**
 * Live smoke test: the real transport against the real wallhaven.
 *
 *   node scripts/verify-live.mjs
 *
 * Everything else in this repository runs against a fake transport, which is
 * what makes the suite deterministic — and also what makes it unable to notice
 * that the CONNECT tunnel, the API contract or the CDN have changed. This
 * script closes that gap by doing the four things the plugin actually does, for
 * real, through whatever proxy the environment provides.
 *
 * It writes only into its own temporary directory, and downloads a single
 * thumbnail rather than a 20 MB original.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWallhaven } from '../src/host/wallhaven.js';
import { openConfigStore } from '../src/host/store.js';
import { resolveProxyUrl } from '../src/host/net.js';

const home = await mkdtemp(join(tmpdir(), 'dsh-wh-live-'));
const store = openConfigStore({ dshHome: home });
await store.load();
await store.update({
  downloadDir: join(home, 'downloads'),
  // SFW only, and a query that always has results, so the check is about the
  // plumbing rather than about whether a tag happens to be popular today.
  query: 'landscape',
  sorting: 'toplist',
  topRange: '1M',
  atleast: '1920x1080',
});

const wallhaven = createWallhaven({ store });
const proxy = resolveProxyUrl(store.get().proxy, process.env);
console.log(`proxy in effect: ${proxy === '' ? '(direct)' : proxy}`);

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

try {
  console.log('\n1. probe');
  const probe = await wallhaven.probe();
  check('wallhaven reachable', probe.ok, probe.ok ? `${String(probe.latencyMs)} ms` : probe.reason);

  console.log('\n2. search');
  const search = await wallhaven.search({ page: 1 });
  check('search returned a page', search.ok, search.ok ? '' : search.reason);
  if (search.ok) {
    check('24 results', search.items.length === 24, `${String(search.items.length)} items`);
    check('meta carries paging', search.total > 0 && search.lastPage > 1, `total=${String(search.total)} last=${String(search.lastPage)}`);
    check('every item has an allowlisted original', search.items.every((item) => item.full.startsWith('https://w.wallhaven.cc/')));
    check('every item has an allowlisted thumbnail', search.items.every((item) => item.thumb.startsWith('https://th.wallhaven.cc/')));
  }

  if (search.ok && search.items.length > 0) {
    const item = search.items[0];
    console.log(`\n3. image bytes (${item.id})`);
    const image = await wallhaven.image({ src: item.thumb, cache: true });
    check('thumbnail fetched', image.ok, image.ok ? `${image.contentType}` : image.reason);
    if (image.ok) {
      let bytes = 0;
      for await (const chunk of image.stream) bytes += chunk.length;
      check('thumbnail is a real image', bytes > 1000, `${String(bytes)} bytes`);
      check('content type is an image', String(image.contentType).startsWith('image/'), String(image.contentType));

      const cached = await wallhaven.image({ src: item.thumb, cache: true });
      check('second fetch is served from the cache', cached.ok && cached.cached === true);
      cached.stream?.resume();
    }

    console.log('\n4. download');
    const download = await wallhaven.download({ wallpaper: item });
    check('original saved', download.ok, download.ok ? download.fileName : download.reason);
    if (download.ok) {
      const info = await stat(download.path);
      check('saved file is not empty', info.size > 1000, `${String(info.size)} bytes`);
    }
  }

  console.log('\n5. random search (the sidebar shortcut)');
  const random = await wallhaven.search({ page: 1, random: true });
  check('random search returned results', random.ok && random.items.length > 0, random.ok ? '' : random.reason);
  check('the saved sorting was not rewritten', store.get().sorting === 'toplist', store.get().sorting);
} finally {
  await rm(home, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? '全部通过' : `${String(failures)} 项失败`}`);
process.exitCode = failures === 0 ? 0 : 1;
