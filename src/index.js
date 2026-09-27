/*
 * Host half of `dsh-wallhaven-wallpaper`.
 *
 * Responsibilities, in full:
 *   · keep this plugin's configuration document under `$DSH_HOME/storages/`;
 *   · own the prefix `/plugins/dsh-wallhaven-wallpaper`, through which the
 *     settings page searches wallhaven, streams images, saves originals and
 *     reads its own status;
 *   · report which DSH is running and which of those integration points it
 *     actually accepted.
 *
 * It publishes no service, rewrites no other plugin's row, replaces no Slot,
 * and never changes model routing. The only file it writes outside its storage
 * directory is the wallpaper the user explicitly asked it to download — and the
 * only network it touches is wallhaven, through the proxy the user configured.
 *
 * ◆ Applying on an unknown harness
 *   DSH ships nightly and this plugin is installed from a git URL, so "the
 *   version you have" and "the version this was written against" are routinely
 *   different. Nothing in this file may therefore throw out of `apply`: an
 *   exception while a fiber is applying fails that row, and on some harness
 *   versions a failed row is reported as a failed boot. Every harness call is
 *   made through a probe that records its outcome (see `host/compat.js` and
 *   `shared/compat.js`), so the worst case is a plugin that says *what* it could
 *   not find — not a GUI that will not start.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { PKG, ROUTE_BASE } from './shared/constants.js';
import { reasonOf, registerPrefixRoute } from './shared/compat.js';
import { createHostCompat, describeHostEnvironment } from './host/compat.js';
import { disposeAgents } from './host/net.js';
import { createRouteHandler } from './host/routes.js';
import { openConfigStore } from './host/store.js';
import { createWallhaven } from './host/wallhaven.js';

/** The package name, which is also this plugin's loader row id. */
export const name = PKG;

/** No host service is a hard dependency: without `webServer` this half idles. */
export const inject = [];

/**
 * The harness home: `$DSH_HOME` when set, else `~/.dsh` (DSH's own order).
 *
 * @returns the harness home directory.
 */
export function dshHome() {
  const configured = process.env['DSH_HOME'];
  if (typeof configured === 'string' && configured.trim() !== '') return configured;
  return join(homedir(), '.dsh');
}

/**
 * Mount the host half.
 *
 * @param ctx - the host Cordis context.
 */
export function apply(ctx) {
  // Read the environment before anything else can fail, so the compatibility
  // report still has something to say about a plugin that never got a route.
  let compat;
  try {
    compat = createHostCompat(describeHostEnvironment(ctx));
  } catch (error) {
    ctx.logger?.warn?.(`${PKG}: 无法读取宿主环境：${reasonOf(error)}`);
    compat = createHostCompat({ dshVersion: '', dshVersionStatus: 'unknown', dshVersionSource: 'unknown' });
  }

  ctx.inject(['webServer'], (webCtx) => {
    const logger = webCtx.logger ?? ctx.logger;

    let store;
    let wallhaven;
    try {
      store = openConfigStore({ dshHome: dshHome(), logger });
      wallhaven = createWallhaven({ store, logger });
    } catch (error) {
      // No store means no settings to serve. Report it and stop, rather than
      // throwing into the fiber.
      compat.setRoutes({ ok: false, mode: 'none', error: `配置存储不可用：${reasonOf(error)}` });
      logger?.warn?.(`${PKG}: 配置存储不可用，宿主半未挂载：${reasonOf(error)}`);
      return;
    }

    // Loading is asynchronous, but the route must be registered while the
    // fiber is still applying — so the handler awaits this promise instead of
    // the registration awaiting the disk.
    const ready = store.load().then(
      () => undefined,
      (error) => {
        logger?.warn?.(`${PKG}: 读取配置失败，使用默认值继续：${error.message}`);
      },
    );

    webCtx.effect(() => {
      const registration = registerPrefixRoute(
        webCtx.webServer,
        ROUTE_BASE,
        createRouteHandler({ store, wallhaven, logger, ready, compat }),
      );
      compat.setRoutes(registration);
      if (!registration.ok) {
        // The route is the whole host half. Say so once, clearly, with the
        // reason the harness gave — the settings page repeats it, because the
        // person who needs it is not reading this log.
        logger?.warn?.(
          `${PKG}: 宿主路由 ${ROUTE_BASE} 未注册（DSH ${compat.environment.dshVersion || '未知'}）：${registration.error}`,
        );
      }
      return () => {
        registration.dispose();
        // Tunnels own sockets; releasing the route must release them too, or an
        // update would leave the previous configuration's proxy connected.
        disposeAgents();
      };
    }, `${PKG}: wallhaven routes`);
  });
}
