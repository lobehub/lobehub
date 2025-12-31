import { app } from 'electron';
import { join } from 'node:path';

export const mainDir = join(__dirname);

export const preloadDir = join(mainDir, '../preload');

export const resourcesDir = join(mainDir, '../../resources');

export const buildDir = join(mainDir, '../../build');

const appPath = app.getAppPath();

export const nextStandaloneDir = join(appPath, 'dist', 'next');

export const userDataDir = app.getPath('userData');

export const appStorageDir = join(userDataDir, 'lobehub-storage');

// ------  Application storage directory ---- //

// db schema hash
export const DB_SCHEMA_HASH_FILENAME = 'lobehub-local-db-schema-hash';
// pglite database dir
export const LOCAL_DATABASE_DIR = 'lobehub-local-db';
// Local storage files (simulating S3)
export const FILE_STORAGE_DIR = 'file-storage';
// Plugin installation directory
export const INSTALL_PLUGINS_DIR = 'plugins';

// Desktop file service
export const LOCAL_STORAGE_URL_PREFIX = '/lobe-desktop-file';
