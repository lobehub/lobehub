import { OFFICIAL_URL } from '@lobechat/const/url';
import { createEnv } from '@t3-oss/env-core';
import { memoize } from 'es-toolkit';
import { z } from 'zod';

const normalizeEnvString = (input: unknown) => {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

const envBoolean = (defaultValue: boolean) =>
  z
    .preprocess((input) => {
      const str = normalizeEnvString(input);
      if (!str) return undefined;

      switch (str.toLowerCase()) {
        case '1':
        case 'true':
        case 'yes':
        case 'y':
        case 'on': {
          return true;
        }

        case '0':
        case 'false':
        case 'no':
        case 'n':
        case 'off': {
          return false;
        }

        default: {
          return undefined;
        }
      }
    }, z.boolean().optional())
    .default(defaultValue);

const envNumber = (defaultValue: number) =>
  z
    .preprocess((input) => {
      const str = normalizeEnvString(input);
      if (!str) return undefined;
      const num = Number(str);
      if (!Number.isFinite(num)) return undefined;
      return num;
    }, z.number().optional())
    .default(defaultValue);

// The spread stays live at runtime; the explicit entries below are the ones
// `vite.main.config.ts` statically replaces at build time. A packaged app has no
// shell to inherit env from, so anything that must survive packaging has to be
// listed here AND defined there — the spread alone silently yields undefined.
const getRuntimeEnv = () => ({
  ...process.env,
  DESKTOP_APP_ID: process.env.DESKTOP_APP_ID,
  DESKTOP_CLI_BIN_NAMES: process.env.DESKTOP_CLI_BIN_NAMES,
  DESKTOP_PRODUCT_NAME: process.env.DESKTOP_PRODUCT_NAME,
  DESKTOP_PROTOCOL_SCHEME: process.env.DESKTOP_PROTOCOL_SCHEME,
  DESKTOP_BACKEND_PROXY_RETHROW_ERRORS: process.env.DESKTOP_BACKEND_PROXY_RETHROW_ERRORS,
  DESKTOP_DISABLE_UPDATES: process.env.DESKTOP_DISABLE_UPDATES,
  DESKTOP_EXTERNAL_NAVIGATION_HOSTS: process.env.DESKTOP_EXTERNAL_NAVIGATION_HOSTS,
  DEVICE_GATEWAY_ENABLED: process.env.DEVICE_GATEWAY_ENABLED,
  DEVICE_GATEWAY_URL: process.env.DEVICE_GATEWAY_URL,
  OFFICIAL_CLOUD_SERVER: process.env.OFFICIAL_CLOUD_SERVER,
  UPDATE_CHANNEL: process.env.UPDATE_CHANNEL,
  UPDATE_SERVER_URL: process.env.UPDATE_SERVER_URL,
});

/**
 * Desktop (Electron main process) runtime env access.
 *
 * Important:
 * - Keep schemas tolerant (optional + defaults) to avoid throwing in tests/dev.
 * - Prefer reading env at call-time (factory) so tests can mutate process.env safely.
 */
export const getDesktopEnv = memoize(() =>
  createEnv({
    client: {},
    clientPrefix: 'PUBLIC_',
    emptyStringAsUndefined: true,
    isServer: true,
    runtimeEnv: getRuntimeEnv(),
    server: {
      DEBUG_VERBOSE: envBoolean(false),

      // escape hatch: allow testing static renderer in dev via env
      DESKTOP_RENDERER_STATIC: envBoolean(false),

      // Dev-only failure injection: surface backend proxy errors as uncaught
      // main-process exceptions so Electron's default dialog can be reproduced.
      // This build's application id — the same value `electron-builder.mjs`
      // resolves for `appId`, which the NSIS installer stamps onto the Start
      // Menu shortcut as its AppUserModelID.
      //
      // Windows uses that id to decide which taskbar button a window belongs to
      // and which icon and name a notification carries, so the running app has
      // to claim the same one. Keep the fallback below in step with
      // `electron-builder.mjs`.
      DESKTOP_APP_ID: z.string().optional().default('com.lobehub.lobehub-desktop'),
      /**
       * Comma-separated command names the CLI wrapper installs, primary first.
       * Unset keeps the built-in `lobehub,lh,lobe`.
       */
      DESKTOP_CLI_BIN_NAMES: z.string().optional(),
      /**
       * The app's own name, used for the per-user data directory. Unset keeps
       * Electron's default, which is `productName ?? name` from the packaged
       * manifest — this repository's package name.
       */
      DESKTOP_PRODUCT_NAME: z.string().optional(),

      /**
       * Overrides the OS-registered deep-link/OAuth-handoff scheme
       * (`getProtocolScheme()`'s default is channel-derived and always
       * `lobehub`-prefixed). Must match `electron-builder.mjs`'s own
       * `DESKTOP_PROTOCOL_SCHEME` read, which sets the OS-level registration —
       * a mismatch here leaves the app registering as a scheme the OS never
       * points at it for, or worse, still fighting the official app for
       * `lobehub://`.
       */
      DESKTOP_PROTOCOL_SCHEME: z.string().optional(),

      DESKTOP_BACKEND_PROXY_RETHROW_ERRORS: envBoolean(false),

      // Whether this build ships an update feed at all.
      //
      // Read by `electron-builder.mjs` to drop the publish config, and here so
      // the main process agrees with it. A distribution with no feed of its own
      // must not fall through to the upstream GitHub provider, which is both a
      // phone-home an air-gapped install cannot make and an upgrade path
      // straight off the distribution.
      DESKTOP_DISABLE_UPDATES: envBoolean(false),

      DESKTOP_EXTERNAL_NAVIGATION_HOSTS: z.string().optional().default(''),

      // Whether this build ships with the device gateway on by default.
      //
      // The gateway is a hosted rendezvous service. A distribution that does not
      // run one has an app opening a WebSocket to somebody else's host on every
      // launch, so it needs to be able to turn the default off at build time.
      // The user-facing toggle is unaffected — this only sets where it starts.
      DEVICE_GATEWAY_ENABLED: envBoolean(true),

      // device gateway url override (dev: point at a local `wrangler dev` instance,
      // e.g. http://localhost:8787). Falls back to the stored value, then the
      // production gateway.
      DEVICE_GATEWAY_URL: z.string().url().optional(),

      // Force use dev-app-update.yml even in packaged app (for testing updates)
      FORCE_DEV_UPDATE_CONFIG: envBoolean(false),

      // mcp client
      MCP_TOOL_TIMEOUT: envNumber(60_000),

      // keep optional to preserve existing behavior:
      // - unset NODE_ENV should behave like "not production" in logger runtime paths
      NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

      // cloud server url (can be overridden for selfhost/dev)
      OFFICIAL_CLOUD_SERVER: z.string().optional().default(OFFICIAL_URL),

      // updater
      // process.env.xxx will replace in build stage
      UPDATE_CHANNEL: z.string().optional().default(process.env.UPDATE_CHANNEL),

      // Custom update server URL (for stable channel)
      // e.g., https://releases.lobehub.com/stable or https://your-bucket.s3.amazonaws.com/releases
      UPDATE_SERVER_URL: z.string().optional().default(process.env.UPDATE_SERVER_URL),

      // Vercel JWT for bypassing deployment protection (dev only)
      VERCEL_JWT: z.string().optional(),
    },
  }),
);
