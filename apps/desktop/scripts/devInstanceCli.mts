/**
 * Shell entry to `devInstance.mts` for `.agents/acceptance/scripts/electron-dev.sh`.
 *
 *   node scripts/devInstanceCli.mts env --cdp-port 9223 --renderer-port 5174 [--user-data DIR] [--label TEXT]
 *   node scripts/devInstanceCli.mts checkout-label DIR
 *   node scripts/devInstanceCli.mts wait-renderer --cdp-port 9223 --timeout-s 60
 *   node scripts/devInstanceCli.mts signed-in --cdp-port 9223
 *   node scripts/devInstanceCli.mts seed-login --user-data DIR --snapshot DIR
 *   node scripts/devInstanceCli.mts save-login --user-data DIR --snapshot DIR [--signed-in 1]
 *   node scripts/devInstanceCli.mts login-status --snapshot DIR
 *
 * `env` prints one `KEY=value` per line; messages carry the `[electron-dev]` prefix.
 */
import { stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  createDesktopDevInstance,
  describeLoginState,
  getDesktopDevEnvironment,
  probeDesktopSignedIn,
  readCheckoutLabel,
  saveLoginState,
  seedLoginState,
  waitForDesktopWindow,
} from './devInstance.mts';

const log = (message: string) => console.log(`[electron-dev] ${message}`);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'cdp-port': { type: 'string' },
    'label': { type: 'string' },
    'renderer-port': { type: 'string' },
    'signed-in': { type: 'string' },
    'snapshot': { type: 'string' },
    'timeout-s': { type: 'string' },
    'user-data': { type: 'string' },
  },
});

const required = (name: keyof typeof values) => {
  const value = values[name];
  if (typeof value !== 'string' || value.length === 0) {
    console.error(`[electron-dev] --${name} is required`);
    process.exit(64);
  }
  return value;
};

const port = (name: 'cdp-port' | 'renderer-port') => {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`[electron-dev] --${name} must be a positive integer`);
    process.exit(64);
  }
  return value;
};

const [command, argument] = positionals;

switch (command) {
  case 'env': {
    const environment = getDesktopDevEnvironment(
      createDesktopDevInstance({
        cdpPort: port('cdp-port'),
        label: values.label,
        // Pool instances sign in to test accounts and copy logins between profiles.
        mockKeychain: true,
        rendererPort: port('renderer-port'),
        userDataDirectory: values['user-data'],
      }),
    );
    for (const [key, value] of Object.entries(environment)) console.log(`${key}=${value}`);
    break;
  }

  case 'checkout-label': {
    console.log(await readCheckoutLabel(argument ?? process.cwd()));
    break;
  }

  case 'wait-renderer': {
    const timeoutS = Number(values['timeout-s'] ?? 60);
    log(`Waiting for the renderer to render (up to ${timeoutS}s)...`);
    const rendered = await waitForDesktopWindow({
      cdpPort: port('cdp-port'),
      timeoutMs: timeoutS * 1000,
    });
    if (rendered) {
      log('Renderer ready.');
    } else {
      log(`WARNING: Renderer did not render within ${timeoutS}s — proceeding anyway.`);
      process.exitCode = 1;
    }
    break;
  }

  case 'signed-in': {
    console.log((await probeDesktopSignedIn(port('cdp-port'))) ? '1' : '0');
    break;
  }

  case 'seed-login': {
    const target = required('user-data');
    const result = await seedLoginState(target, [
      { directory: required('snapshot'), label: 'saved login state' },
    ]);
    if (result.status === 'none') {
      log(
        `WARNING: no login state at ${values.snapshot} — instance will start signed out; sign in once and 'stop' will capture it.`,
      );
    } else if (result.status === 'seeded') {
      log(`Seeding userData from ${result.source.label} → ${target}`);
      if (!result.canReauth)
        log(
          "  note: no refresh token on disk — a cookie session may still carry it; otherwise sign in once and 'stop' will capture it.",
        );
    }
    break;
  }

  case 'save-login': {
    const source = required('user-data');
    const snapshotDirectory = required('snapshot');
    const result = await saveLoginState(source, {
      signedIn: values['signed-in'] === '1',
      snapshotDirectory,
    });
    if (result === 'signed-out')
      log(
        `Not saving login state: ${source} is signed out (the app cleared its refresh token) — kept the previous snapshot.`,
      );
    else if (result === 'saved')
      log(`Saved login state → ${snapshotDirectory} (refresh token captured)`);
    else if (result === 'saved-cookie-only')
      log(
        `Saved login state → ${snapshotDirectory} (cookie session only — no refresh token on disk)`,
      );
    break;
  }

  case 'login-status': {
    const snapshot = required('snapshot');
    console.log(`  ${await describeLoginState('saved snapshot', snapshot)}`);
    const present = await stat(snapshot).then(
      () => true,
      () => false,
    );
    if (!present) {
      log(
        "Nothing to seed from: sign in once inside the app, then 'save-login <id>' (or just 'stop <id>').",
      );
      process.exitCode = 2;
      break;
    }
    log("Note: 'expiresAt' in the profile is the ACCESS token's lifetime, not the");
    log("refresh token's — a stale one is normal and gets refreshed on boot. Only a");
    log("missing refresh token means signed out. 'stop'/'save-login' also probe the");
    log('running renderer, so a cookie-only session is captured too.');
    break;
  }

  default: {
    console.error(
      'Usage: devInstanceCli.mts {env|checkout-label|wait-renderer|signed-in|seed-login|save-login|login-status}',
    );
    process.exit(64);
  }
}
