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
// Heterogeneous-agent (CC / Codex) working directory — holds the downloaded
// file cache (`<HETERO_AGENT_DIR>/files`) and, in packaged builds, CLI trace
// sessions (`<HETERO_AGENT_DIR>/tracing`). Single source of truth so the
// controller and the Help-menu "open dir" entry never drift.
export const HETERO_AGENT_DIR = 'heteroAgent';
export const HETERO_AGENT_FILES_DIR = `${HETERO_AGENT_DIR}/files`;
export const HETERO_AGENT_TRACING_DIR = `${HETERO_AGENT_DIR}/tracing`;

// Desktop file service
export const LOCAL_STORAGE_URL_PREFIX = '/lobe-desktop-file';
