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

export const userDataDir = app.getPath('userData');

export const appStorageDir = path.join(userDataDir, 'lobehub-storage');

// Legacy local database directory used in older desktop versions
export const legacyLocalDbDir = path.join(appStorageDir, 'lobehub-local-db');

// ------  Application storage directory ---- //

// Local storage files (simulating S3)
export const FILE_STORAGE_DIR = 'file-storage';
// Plugin installation directory
export const INSTALL_PLUGINS_DIR = 'plugins';

// Desktop file service
export const LOCAL_STORAGE_URL_PREFIX = '/lobe-desktop-file';
