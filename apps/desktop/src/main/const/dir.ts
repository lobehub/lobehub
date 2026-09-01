import path from 'node:path';

import { app } from 'electron';

export const mainDir = path.join(__dirname);

export const preloadDir = path.join(mainDir, '../preload');

export const resourcesDir = path.join(mainDir, '../../resources');

export const buildDir = path.join(mainDir, '../../build');

export const binDir = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(resourcesDir, 'bin');

const appPath = app.getAppPath();

export const rendererDir = path.join(appPath, 'dist', 'renderer');

/**
 * Resolved on call, never at module evaluation.
 *
 * `pre-app-init.ts` moves a packaged build off this repository's own
 * `lobehub-desktop-dev` profile with `app.setPath('userData', ...)`, but the
 * bundler hoists the chunk carrying this module ahead of that file's inlined
 * code. A top-level `app.getPath('userData')` here therefore captured the
 * pre-override default, and every path derived from it kept pointing into the
 * dev profile -- which is how a shipped build recorded
 * `%APPDATA%/lobehub-desktop-dev/lobehub-storage` as its storage path while its
 * own settings file correctly sat under the product name.
 *
 * A function moves the lookup to first use, which is always after
 * `pre-app-init` has run, so it cannot lose that race however the bundle is
 * ordered.
 */
export const getUserDataDir = () => app.getPath('userData');

export const getAppStorageDir = () => path.join(getUserDataDir(), 'lobehub-storage');

/** Legacy local database directory used in older desktop versions. */
export const getLegacyLocalDbDir = () => path.join(getAppStorageDir(), 'lobehub-local-db');

// ------  Application storage directory ---- //

// Local storage files (simulating S3)
export const FILE_STORAGE_DIR = 'file-storage';
// Plugin installation directory
export const INSTALL_PLUGINS_DIR = 'plugins';

// Desktop file service
export const LOCAL_STORAGE_URL_PREFIX = '/lobe-desktop-file';
