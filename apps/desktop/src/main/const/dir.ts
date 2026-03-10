import { app } from 'electron';
import { join } from 'node:path';

export const mainDir = join(__dirname);

export const preloadDir = join(mainDir, '../preload');

export const resourcesDir = join(mainDir, '../../resources');

export const buildDir = join(mainDir, '../../build');

const appPath = app.getAppPath();

export const rendererDir = join(appPath, 'dist', 'renderer');

export const userDataDir = app.getPath('userData');

export const appStorageDir = join(userDataDir, 'lobehub-storage');

// Legacy local database directory used in older desktop versions
export const legacyLocalDbDir = join(appStorageDir, 'lobehub-local-db');

// ------  Application storage directory ---- //

// Local storage files (simulating S3)
export const FILE_STORAGE_DIR = 'file-storage';
// Plugin installation directory
export const INSTALL_PLUGINS_DIR = 'plugins';

// Desktop file service
export const LOCAL_STORAGE_URL_PREFIX = '/lobe-desktop-file';
