/*
 * Version adaptation: how this plugin survives a DSH it was not built against.
 *
 * ★ Same two-way loading rule as `./constants.js`: the host half imports this
 *   as an ES module, and the client half gets it **inlined** by
 *   `scripts/build.mjs` with its `export ` keywords stripped. So: no `import`,
 *   no top-level `await`, plain declarations only.
 *
 * ◆ The posture
 *   Nothing here decides behaviour from a version *number*. A version string is
 *   only ever displayed, never branched on: DSH ships nightly, and a plugin that
 *   says "0.1.7 or newer" is wrong the day a 0.1.8 renames one method. What this
 *   module does instead is make every integration point **optional and
 *   independently failable**:
 *
 *     · each call into the harness is attempted, and its outcome recorded;
 *     · a call that throws degrades that one surface, never the plugin row;
 *     · the recorded outcomes are shown to the user, so an unsupported harness
 *       says *which* piece is missing instead of silently doing nothing.
 *
 *   {@link VERIFIED_DSH_VERSIONS} is the one place a version list appears, and
 *   it is advisory only — it feeds the "已实测 / 未实测" label next to the
 *   detected version so a user on an untested build knows to look at the
 *   capability rows rather than assume the worst.
 */

/**
 * The DSH runtime versions this plugin has actually been exercised against.
 *
 * Advisory only — see the file comment. `0.1.6-alpha.1` is the generation the
 * client half was originally written for; `0.1.7-rc.2` is the generation the
 * compatibility layer was added on. Both were verified end to end (host routes,
 * served client bundle, live settings page).
 */
export const VERIFIED_DSH_VERSIONS = ['0.1.6-alpha.1', '0.1.7-rc.2'];

/** Statuses a capability row can carry, worst last. */
export const COMPAT_STATUSES = ['ok', 'degraded', 'missing'];

/* ── version strings ──────────────────────────────────────────────────────── */

/**
 * Split a semver-ish version into comparable parts.
 *
 * Tolerant on purpose: DSH versions in the wild include `0.1.6-alpha.1`,
 * `0.1.7-rc.2`, and plain `0.1.7`. Anything without at least a major.minor is
 * rejected rather than guessed at, because a wrong number displayed to the user
 * is worse than no number.
 *
 * @param value - the candidate version string.
 * @returns `{ major, minor, patch, prerelease, raw }`, or `null`.
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?\s*$/.exec(value);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4] === undefined ? '' : match[4],
    raw: value.trim(),
  };
}

/**
 * Whether `value` is the same as, or newer than, `floor`.
 *
 * Only used for the advisory label and for tests; no behaviour is gated on it.
 * A prerelease sorts *below* its release (`0.1.7-rc.2 < 0.1.7`), which is what
 * semver says and what a reader expects.
 *
 * @param value - the version to test.
 * @param floor - the version to compare against.
 * @returns whether `value >= floor`.
 */
export function versionAtLeast(value, floor) {
  const left = parseVersion(value);
  const right = parseVersion(floor);
  if (left === null || right === null) return false;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key];
  }
  if (left.prerelease === right.prerelease) return true;
  if (left.prerelease === '') return true;
  if (right.prerelease === '') return false;
  return left.prerelease >= right.prerelease;
}

/**
 * Classify a detected DSH version for display.
 *
 * @param value - the detected version, or anything else.
 * @param verified - the advisory list; defaults to {@link VERIFIED_DSH_VERSIONS}.
 * @returns `'verified'`, `'untested'`, or `'unknown'`.
 */
export function classifyVersion(value, verified) {
  const parsed = parseVersion(value);
  if (parsed === null) return 'unknown';
  const list = Array.isArray(verified) ? verified : VERIFIED_DSH_VERSIONS;
  return list.indexOf(parsed.raw) >= 0 ? 'verified' : 'untested';
}

/* ── the capability report ────────────────────────────────────────────────── */

/**
 * One row of the compatibility report.
 *
 * @param id - stable key, used as the React key and the test handle.
 * @param label - the row's title, already localized by the caller.
 * @param status - one of {@link COMPAT_STATUSES}.
 * @param detail - what was found, in the caller's words.
 * @returns the row.
 */
export function compatEntry(id, label, status, detail) {
  return {
    id,
    label,
    status: COMPAT_STATUSES.indexOf(status) >= 0 ? status : 'degraded',
    detail: typeof detail === 'string' ? detail : '',
  };
}

/**
 * Fold capability rows into one verdict.
 *
 * `failed` counts only the rows that are genuinely absent, so a harness missing
 * the optional sidebar seat still reads as healthy — it is a smaller feature
 * set, not a broken plugin.
 *
 * @param entries - rows from {@link compatEntry}.
 * @returns `{ total, ok, degraded, failed, verdict }`.
 */
export function summarizeCompat(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  let ok = 0;
  let degraded = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === 'ok') ok += 1;
    else if (row.status === 'missing') failed += 1;
    else degraded += 1;
  }
  return {
    total: rows.length,
    ok,
    degraded,
    failed,
    verdict: failed > 0 ? 'unsupported' : degraded > 0 ? 'partial' : 'full',
  };
}

/** Turn an unknown thrown value into a short, printable reason. */
export function reasonOf(error) {
  if (error === null || error === undefined) return '未知错误';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message !== '') return error.message;
  return String(error);
}

/* ── locale: two registration overloads, one caller ───────────────────────── */

/**
 * Register this plugin's dictionaries against whichever overload the running
 * DSH has.
 *
 * DSH 0.1.6+ exposes `register(ns, { zh, en })`; the per-locale form
 * `register(ns, locale, dict)` is the older, narrower shape. Both are attempted
 * in that order — the bundled one first because it is atomic, the per-locale
 * one second because a partial failure there can be rolled back.
 *
 * @param locale - the `ctx.locale` service (or anything else).
 * @param ns - the namespace to register under.
 * @param dictionaries - `{ <localeId>: { <key>: <text> } }`.
 * @returns `{ ok, mode, dispose, error }`; `dispose` is always a function when
 *   `ok`, so the caller can register it as an effect unconditionally.
 */
export function registerLocaleDictionary(locale, ns, dictionaries) {
  const none = { ok: false, mode: 'none', dispose: () => undefined, error: '' };
  if (locale === null || typeof locale !== 'object' || typeof locale.register !== 'function') {
    return { ...none, error: 'locale 服务没有 register()' };
  }
  const ids = Object.keys(dictionaries);

  let bundledError = '';
  try {
    const dispose = locale.register(ns, dictionaries);
    return {
      ok: true,
      mode: 'bundled',
      dispose: typeof dispose === 'function' ? dispose : () => undefined,
      error: '',
    };
  } catch (error) {
    bundledError = reasonOf(error);
  }

  // Per-locale fallback. A throw halfway through must not leave half the
  // dictionaries registered under a namespace this plugin will then re-register.
  const disposers = [];
  try {
    for (const id of ids) {
      const dispose = locale.register(ns, id, dictionaries[id]);
      if (typeof dispose === 'function') disposers.push(dispose);
    }
    return {
      ok: true,
      mode: 'per-locale',
      dispose: () => {
        for (const dispose of disposers) dispose();
      },
      error: '',
    };
  } catch (error) {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // A disposer that throws on rollback is not worth reporting twice.
      }
    }
    return { ...none, error: `bundled: ${bundledError}; per-locale: ${reasonOf(error)}` };
  }
}

/**
 * The translator the page renders through.
 *
 * Prefers the harness's own `bind(ns)` — it is the only version that follows a
 * live locale switch — and falls back to a translator over this plugin's own
 * dictionaries. The fallback is what keeps the settings page *readable* on a
 * harness whose locale service changed shape: it shows English (or Chinese)
 * instead of not rendering at all.
 *
 * @param locale - the `ctx.locale` service (or anything else).
 * @param ns - the namespace the dictionaries were registered under.
 * @param dictionaries - the same map handed to {@link registerLocaleDictionary}.
 * @param preferred - which dictionary the fallback should read; `'zh'` or `'en'`.
 * @returns `{ t, mode }` where `t(key, params?)` always returns a string.
 */
export function createTranslator(locale, ns, dictionaries, preferred) {
  const ids = Object.keys(dictionaries);
  const wanted = typeof preferred === 'string' ? preferred.toLowerCase() : '';
  // Exact id first, then the language subtag: a harness reporting `zh-CN` or
  // `zh-Hans` must still land on the `zh` dictionary rather than silently
  // falling through to whichever dictionary happened to be declared first.
  const exact = ids.find((id) => id.toLowerCase() === wanted);
  const prefix = ids.find((id) => wanted !== '' && wanted.split('-')[0] === id.toLowerCase().split('-')[0]);
  const chosen = exact ?? prefix ?? ids[0];

  if (locale !== null && typeof locale === 'object' && typeof locale.bind === 'function') {
    try {
      const bound = locale.bind(ns);
      if (typeof bound === 'function') {
        // Probe once: a `bind` that exists but answers `undefined` for a key it
        // was just given is not a translator, and the page would render blank.
        const probe = bound('title');
        if (typeof probe === 'string' && probe !== '') return { t: bound, mode: 'bound' };
      }
    } catch {
      // Fall through to the local dictionary.
    }
  }

  const table = chosen === undefined ? {} : dictionaries[chosen];
  const t = (key) => {
    const text = typeof table === 'object' && table !== null ? table[key] : undefined;
    return typeof text === 'string' ? text : String(key);
  };
  return { t, mode: 'local' };
}

/* ── client Slots ─────────────────────────────────────────────────────────── */

/**
 * Register one client Slot surface, isolating its failure.
 *
 * The plugin occupies two **additive** seats (`settings.section` and
 * `sidebar.footer.action`), and they are independent: a harness that no longer
 * declares the sidebar seat must still get the settings page. Registering them
 * through here is what makes that true — a throw is recorded, not propagated.
 *
 * @param slots - the `ctx.slots` service (or anything else).
 * @param key - the Slot key to occupy.
 * @param declaration - the registration fields, `name` excluded (it is `key`).
 * @param component - the component to render in the seat.
 * @returns `{ ok, dispose, error }`.
 */
export function registerSlotSurface(slots, key, declaration, component) {
  if (slots === null || typeof slots !== 'object') {
    return { ok: false, dispose: () => undefined, error: 'slots 服务不存在' };
  }
  if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    return { ok: false, dispose: () => undefined, error: 'slots 服务没有 inject()/register()' };
  }
  try {
    const dispose = slots.inject(key, () => slots.register({ ...declaration, name: key }, component));
    return {
      ok: true,
      dispose: typeof dispose === 'function' ? dispose : () => undefined,
      error: '',
    };
  } catch (error) {
    return { ok: false, dispose: () => undefined, error: reasonOf(error) };
  }
}

/* ── host routes ──────────────────────────────────────────────────────────── */

/**
 * Claim this plugin's route prefix, tolerating a changed registration shape.
 *
 * `register({ kind: 'prefix', path, handler })` is the shape DSH 0.1.6 and
 * 0.1.7 both take. It is called through here so that a harness which renames or
 * rejects it produces one recorded failure — the plugin's settings page then
 * says "宿主路由未注册" — instead of an exception thrown while the fiber is
 * applying, which would take the whole row down and, on some harness versions,
 * the boot with it.
 *
 * @param webServer - the `webServer` service (or anything else).
 * @param path - the prefix to claim.
 * @param handler - the `(req, res)` handler.
 * @returns `{ ok, mode, dispose, error }`.
 */
export function registerPrefixRoute(webServer, path, handler) {
  const none = { ok: false, mode: 'none', dispose: () => undefined, error: '' };
  if (webServer === null || typeof webServer !== 'object' || typeof webServer.register !== 'function') {
    return { ...none, error: 'webServer 服务没有 register()' };
  }
  try {
    const dispose = webServer.register({ kind: 'prefix', path, handler });
    if (typeof dispose !== 'function') {
      // Registered, but this version hands back nothing to call on teardown.
      return { ok: true, mode: 'no-disposer', dispose: () => undefined, error: '' };
    }
    return { ok: true, mode: 'disposer', dispose, error: '' };
  } catch (error) {
    return { ...none, error: reasonOf(error) };
  }
}
