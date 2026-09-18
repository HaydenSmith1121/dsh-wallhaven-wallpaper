/*
 * Where this plugin's configuration lives.
 *
 * One JSON document under `$DSH_HOME/storages/dsh-wallhaven-wallpaper/`, which
 * is the same corner of the harness home `dsh-usage-stats` and friends use for
 * their own durable state — this plugin deliberately does not push its settings
 * into the harness's shared `settings.yaml`, because that document is the
 * product's, and a third-party plugin's wallpaper choice is not.
 *
 * Writes are atomic (temp file + rename) and serialized, so a crash during a
 * write leaves either the old document or the new one, never half of either.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { CONFIG_DEFAULTS, PKG, normalizeConfig } from '../shared/constants.js';

/** The subdirectory of `$DSH_HOME/storages` this plugin owns. */
const STORAGE_NAMESPACE = PKG;

/**
 * Read the configuration document.
 *
 * @param file - absolute path of `config.json`.
 * @returns the raw parsed object, or `null` when absent or unreadable.
 */
async function readDocument(file) {
  try {
    const text = await readFile(file, 'utf8');
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    // A corrupt document is moved aside rather than deleted: it is the only
    // copy of the user's API key and download directory, and a bug that
    // produced it is worth being able to inspect.
    try {
      await rename(file, `${file}.corrupt-${String(Date.now())}`);
    } catch {
      /* Nothing further to do; the caller still gets clean defaults. */
    }
    return null;
  }
}

/**
 * Open this plugin's configuration store.
 *
 * @param options - `{ dshHome, logger }`.
 * @returns `{ get, update, describe }`, all safe to call concurrently.
 */
export function openConfigStore(options) {
  const dshHome = options.dshHome;
  const logger = options.logger;
  const directory = join(dshHome, 'storages', STORAGE_NAMESPACE);
  const file = join(directory, 'config.json');

  /** The in-memory truth; every read returns this same immutable object. */
  let current = CONFIG_DEFAULTS;
  /** Serializes writers: `update` composes onto the previous write's result. */
  let queue = Promise.resolve();

  /**
   * Replace the in-memory configuration with `next`, writing it to disk first.
   *
   * @param next - the full configuration to persist.
   * @returns when the document is durable.
   */
  async function persist(next) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${String(process.pid)}-${String(Date.now())}`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    try {
      await rename(temporary, file);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  return {
    /** The configuration as it stands. */
    get() {
      return current;
    },

    /** Where the document is, for the status line and the README. */
    describe() {
      return { directory, file };
    },

    /**
     * Load the document from disk once, validating it.
     *
     * @returns when the in-memory configuration mirrors the disk.
     */
    async load() {
      const document = await readDocument(file);
      current = normalizeConfig(document ?? {}, CONFIG_DEFAULTS);
      if (document === null) {
        // First run: create the document so the path shown in the UI is real
        // and writable, which is the cheapest way to make a permissions
        // problem visible before the user has anything to lose.
        await persist(current).catch((error) => {
          logger?.warn?.(`${PKG}: 无法写入配置文件 ${file}：${error.message}`);
        });
      }
      return current;
    },

    /**
     * Apply a partial configuration and persist the result.
     *
     * @param patch - the fields to change.
     * @returns the configuration after the merge.
     */
    update(patch) {
      const run = queue.then(async () => {
        const next = normalizeConfig(patch, current);
        await persist(next);
        current = next;
        return next;
      });
      // The chain must survive a failed write, but that failure still belongs
      // to this caller: `run` rejects, `queue` deliberately does not.
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
