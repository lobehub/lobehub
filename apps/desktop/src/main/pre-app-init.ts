import path from 'node:path';

import { app } from 'electron';

import * as electronIs from '@/utils/platform';

// Everything in this file must run BEFORE any module captures
// `app.getPath('userData')` (e.g. `@/const/dir` reads it at top level). Once a
// path is read, `setName` / `setPath` no-op for it.

/**
 * Name the app after the distribution, not after this repository.
 *
 * Electron resolves `app.getName()` to `productName ?? name` from the packaged
 * manifest, and `name` there is this repo's package name — so without this, a
 * white-label build creates and keeps its users' data in a directory named
 * after this project, `-dev` suffix included. `electron-builder`'s own
 * `productName` option names the executable and the installer; it does not
 * reach the manifest Electron reads, and `extraMetadata.productName` does not
 * survive the packaging transform either. Setting it here is the one place
 * that is not fighting a build tool.
 *
 * Same ordering constraint as the dev branch below, and the same permanence
 * warning as `appId`: this decides the userData path, so changing it after a
 * release leaves existing installs looking at an empty profile until they log
 * in again.
 */
const distributionName = process.env.DESKTOP_PRODUCT_NAME?.trim();
if (distributionName && !electronIs.dev()) {
  app.setName(distributionName);
  // `setName` alone changes `app.getPath('userData')`'s *default*, which only
  // takes if nothing has read that path yet — and something in this bundle's
  // require graph reliably does before this line runs, observed shipping a
  // real build's users straight into `~/Library/.../lobehub-desktop-dev`: the
  // same directory (and, on a machine that has ever run this repo's own dev
  // build, the same login session and self-hosted server URL) as the
  // unbranded dev app. `setPath` overrides the internal path table directly,
  // so it isn't subject to that ordering race the way the implicit default is.
  app.setPath('userData', path.join(app.getPath('appData'), distributionName));
}

// Dev uses the same `app://renderer/` origin as prod, so localStorage / cookies /
// IndexedDB would collide if both shared the packaged app's userData dir. Pin dev
// to a sibling directory so prod sessions stay clean.
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
}
