/*
 * The configuration store owns the only file this plugin writes on its own
 * behalf. Its interesting behaviours are all about failure: defaults when the
 * document is missing, survival when it is corrupt, and correctness when two
 * writers arrive at once.
 */

import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONFIG_DEFAULTS } from '../src/shared/constants.js';
import { openConfigStore } from '../src/host/store.js';
import { makeTempDirectory } from './helpers.mjs';

test('load creates the document so the path shown in the UI is real', async () => {
  const temp = await makeTempDirectory();
  try {
    const store = openConfigStore({ dshHome: temp.directory });
    const config = await store.load();
    assert.deepEqual(config, CONFIG_DEFAULTS);

    const { file } = store.describe();
    const written = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(written.purity, '100');
  } finally {
    await temp.cleanup();
  }
});

test('update merges, persists and survives a reload', async () => {
  const temp = await makeTempDirectory();
  try {
    const store = openConfigStore({ dshHome: temp.directory });
    await store.load();
    await store.update({ query: 'mountains', blur: 6 });
    await store.update({ blur: 12 });

    const reopened = openConfigStore({ dshHome: temp.directory });
    const config = await reopened.load();
    assert.equal(config.query, 'mountains');
    assert.equal(config.blur, 12);
  } finally {
    await temp.cleanup();
  }
});

test('concurrent updates are serialized, so neither write is lost', async () => {
  const temp = await makeTempDirectory();
  try {
    const store = openConfigStore({ dshHome: temp.directory });
    await store.load();
    await Promise.all([
      store.update({ query: 'first' }),
      store.update({ blur: 3 }),
      store.update({ scrim: 0.4 }),
    ]);
    const config = store.get();
    assert.equal(config.query, 'first');
    assert.equal(config.blur, 3);
    assert.equal(config.scrim, 0.4);
  } finally {
    await temp.cleanup();
  }
});

test('a corrupt document is moved aside and the plugin starts from defaults', async () => {
  const temp = await makeTempDirectory();
  try {
    const first = openConfigStore({ dshHome: temp.directory });
    await first.load();
    const { file, directory } = first.describe();
    await writeFile(file, '{ this is not json', 'utf8');

    const second = openConfigStore({ dshHome: temp.directory });
    const config = await second.load();
    assert.deepEqual(config, CONFIG_DEFAULTS);

    const entries = await readdir(directory);
    assert.equal(entries.some((entry) => entry.startsWith('config.json.corrupt-')), true);
  } finally {
    await temp.cleanup();
  }
});

test('a failed write rejects its own caller without poisoning later writes', async () => {
  const temp = await makeTempDirectory();
  try {
    const store = openConfigStore({ dshHome: temp.directory });
    await store.load();
    // A non-empty directory where the config file should be makes the final
    // rename impossible on every platform, which is the cleanest stand-in for
    // a full disk or a locked file.
    const { file } = store.describe();
    await rm(file, { force: true });
    await mkdir(file, { recursive: true });
    await writeFile(join(file, 'blocker'), 'x', 'utf8');

    await assert.rejects(store.update({ query: 'will not land' }));
    // The in-memory value never claimed the change that failed to persist.
    assert.equal(store.get().query, CONFIG_DEFAULTS.query);

    await rm(file, { recursive: true, force: true });
    // ...and the next write still works: one failure does not poison the queue.
    const after = await store.update({ blur: 4 });
    assert.equal(after.blur, 4);
    assert.equal(after.query, CONFIG_DEFAULTS.query);
  } finally {
    await temp.cleanup();
  }
});

test('describe points inside $DSH_HOME/storages', async () => {
  const temp = await makeTempDirectory();
  try {
    const store = openConfigStore({ dshHome: temp.directory });
    const { directory, file } = store.describe();
    assert.equal(directory, join(temp.directory, 'storages', 'dsh-wallhaven-wallpaper'));
    assert.equal(file, join(directory, 'config.json'));
  } finally {
    await temp.cleanup();
  }
});
