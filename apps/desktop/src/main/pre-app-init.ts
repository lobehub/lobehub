import path from 'node:path';

import { app } from 'electron';

import * as electronIs from '@/utils/platform';

// Must run BEFORE any module captures `app.getPath('userData')` (e.g. `@/const/dir`
// reads it at top level). Once a path is read, `setName` / `setPath` no-op for it.
//
// Dev now uses the same `app://renderer/` origin as prod, so localStorage / cookies /
// IndexedDB would collide if both shared the packaged-app's userData dir. Pin dev to
// a sibling directory so prod sessions stay clean.
if (electronIs.dev()) {
  // App name stays constant so safeStorage / Chromium cookie encryption keys
  // (OS-keychain entries derived from the app name) keep decrypting a copied
  // login state across instances. Only userData varies per instance, which is
  // enough: Electron's single-instance lock is keyed by the userData dir, so
  // distinct dirs let multiple dev instances run concurrently. Override with an
  // absolute path via LOBE_DESKTOP_USER_DATA_DIR for multi-instance testing.
  app.setName('lobehub-desktop-dev');
  const userDataOverride = process.env.LOBE_DESKTOP_USER_DATA_DIR;
  app.setPath(
    'userData',
    userDataOverride || path.join(app.getPath('appData'), 'lobehub-desktop-dev'),
  );
  // A launcher-managed instance with a test-account profile (`scripts/devInstance.mts`,
  // `mockKeychain`) encrypts tokens and cookies with Chromium's fixed mock key
  // instead of the macOS keychain. The keychain grants access per binary, and the
  // dev Electron is ad-hoc signed and installed once per checkout, so every
  // checkout would ask for the login password again. The fixed key is public, so
  // a profile holding a production login keeps the keychain.
  if (
    userDataOverride &&
    process.env.LOBE_DESKTOP_MOCK_KEYCHAIN === '1' &&
    process.platform === 'darwin'
  )
    app.commandLine.appendSwitch('use-mock-keychain');
}

if (globalThis.__SHELL__) Object.freeze(globalThis.__SHELL__);
