import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import dotenv from 'dotenv';
import { loadEnv } from 'vite';

export const DESKTOP_DIR = __dirname;
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const CLOUD_ROOT_DIR = path.resolve(__dirname, '../../..');

export const isCloudDesktopBuild = process.env.CLOUD_DESKTOP === '1';

// Renderer dev-server port. Overridable per instance (e.g. one git worktree per
// concurrent dev instance) via LOBE_DESKTOP_VITE_PORT; `scripts/dev.mjs` injects
// the matching ELECTRON_RENDERER_URL into the main process. Kept deterministic
// (still `strictPort`) so the HMR `clientPort` stays in sync.
export const DEV_VITE_PORT = Number(process.env.LOBE_DESKTOP_VITE_PORT) || 5173;

// Electron 41 ships Node 24.14 / Chromium 146 — keep in sync when bumping electron.
export const MAIN_NODE_TARGET = 'node24.14';
export const RENDERER_CHROME_TARGET = 'chrome146';

export const desktopPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string };

export const loadDesktopEnv = (mode: string) => {
  dotenv.config();
  Object.assign(process.env, loadEnv(mode, ROOT_DIR, ''));
};

export const nodeExternals = [
  'electron',
  /^electron\/.+/,
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
];

// Keep `process.env` references live at runtime instead of statically replaced
// (electron-vite preset parity); more specific `process.env.X` defines still win.
export const processEnvDefine = {
  'global.process.env': 'global.process.env',
  'globalThis.process.env': 'globalThis.process.env',
  'process.env': 'process.env',
};

export const mainProcessAlias = {
  '@': path.resolve(__dirname, 'src/main'),
  '~common': path.resolve(__dirname, 'src/common'),
};
