/*
 * Host half of `dsh-wallhaven-wallpaper`.
 *
 * Responsibilities, in full:
 *   · keep this plugin's configuration document under `$DSH_HOME/storages/`;
 *   · own the prefix `/plugins/dsh-wallhaven-wallpaper`, through which the
 *     settings page searches wallhaven, streams images, saves originals and
 *     reads its own status.
 *
 * It publishes no service, rewrites no other plugin's row, replaces no Slot,
 * and never changes model routing. The only file it writes outside its storage
 * directory is the wallpaper the user explicitly asked it to download — and the
 * only network it touches is wallhaven, through the proxy the user configured.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { PKG, ROUTE_BASE } from './shared/constants.js';
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
  ctx.inject(['webServer'], (webCtx) => {
    const logger = webCtx.logger ?? ctx.logger;
    const store = openConfigStore({ dshHome: dshHome(), logger });
    const wallhaven = createWallhaven({ store, logger });

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
      const disposeRoute = webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE_BASE,
        handler: createRouteHandler({ store, wallhaven, logger, ready }),
      });
      return () => {
        disposeRoute();
        // Tunnels own sockets; releasing the route must release them too, or an
        // update would leave the previous configuration's proxy connected.
        disposeAgents();
      };
    }, `${PKG}: wallhaven routes`);
  });
}
