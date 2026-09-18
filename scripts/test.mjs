/**
 * Test entry point.
 *
 *   node scripts/test.mjs
 *
 * Every suite is imported into **this** process rather than spawned. DSH's
 * sandbox refuses to create the pipes a child process would need, and running
 * in-process also means the suites share nothing but the module graph, which is
 * exactly the isolation they need.
 *
 * `node:test` runs tests as they are registered and sets a non-zero exit code
 * when any of them fails, so this file needs no reporting of its own.
 */

import './../test/constants.test.mjs';
import './../test/net.test.mjs';
import './../test/store.test.mjs';
import './../test/wallhaven.test.mjs';
import './../test/routes.test.mjs';
