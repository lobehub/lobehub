import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import dotenv from 'dotenv';
import type { ConfigEnv, PluginOption, UserConfig } from 'vite';
import { loadEnv, runnerImport } from 'vite';

export const DESKTOP_DIR = __dirname;
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const CLOUD_ROOT_DIR = path.resolve(__dirname, '../../..');

// Must stay a function: configs call it after `loadDesktopEnv(mode)`, so a
// `CLOUD_DESKTOP=1` coming from `apps/desktop/.env` (not just the CLI env) is seen.
export const isCloudDesktopBuild = () => process.env.CLOUD_DESKTOP === '1';

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
  dotenv.config({ path: path.join(DESKTOP_DIR, '.env') });
  Object.assign(process.env, loadEnv(mode, ROOT_DIR, ''));
};

export const REACT_DEVTOOLS_BRIDGE_URL = 'http://localhost:8097';

/**
 * React DevTools cannot run as a Chrome extension here: its content scripts are
 * registered with `matches: ["<all_urls>"]`, and Chromium rejects widening that
 * to a custom scheme (both in the manifest and via `chrome.scripting`). The
 * renderer always loads from `app://renderer`, so the extension never installs
 * `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` and its devtools panels never appear.
 * The standalone bridge (`npm run react-devtools`) is the only working path —
 * `http://localhost` stays exempt from mixed-content blocking on the secure
 * `app://` origin.
 */
export const reactDevtoolsPlugin = (): PluginOption => ({
  apply: 'serve',
  name: 'lobe-desktop-react-devtools',
  transformIndexHtml: () => [
    { attrs: { src: REACT_DEVTOOLS_BRIDGE_URL }, injectTo: 'head-prepend', tag: 'script' },
  ],
});

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

export type DesktopViteTarget = 'main' | 'preload' | 'renderer';

interface DesktopViteConfigExtensionContext {
  config: UserConfig;
  env: ConfigEnv;
  target: DesktopViteTarget;
}

export type DesktopViteConfigExtension = (
  context: DesktopViteConfigExtensionContext,
) => Promise<UserConfig> | UserConfig;

interface DesktopViteConfigExtensionModule {
  extendDesktopViteConfig?: DesktopViteConfigExtension;
}

export const applyDesktopViteConfigExtension = async (
  target: DesktopViteTarget,
  config: UserConfig,
  env: ConfigEnv,
): Promise<UserConfig> => {
  const configuredPath = process.env.LOBE_DESKTOP_VITE_CONFIG_EXTENSION;
  const extensionPath = configuredPath
    ? path.resolve(process.cwd(), configuredPath)
    : process.env.CLOUD_DESKTOP === '1'
      ? path.resolve(CLOUD_ROOT_DIR, 'scripts/cloud-desktop/vite.config.mts')
      : undefined;

  if (!extensionPath) return config;

  if (!existsSync(extensionPath)) {
    if (configuredPath) {
      throw new Error(`Desktop Vite config extension does not exist: ${extensionPath}`);
    }

    return config;
  }

  const { module: extensionModule } = await runnerImport<DesktopViteConfigExtensionModule>(
    extensionPath,
    { configFile: false, root: path.dirname(extensionPath) },
  );

  if (typeof extensionModule.extendDesktopViteConfig !== 'function') {
    throw new TypeError(
      `Desktop Vite config extension must export extendDesktopViteConfig: ${extensionPath}`,
    );
  }

  return extensionModule.extendDesktopViteConfig({ config, env, target });
};

export const mainProcessAlias = {
  '@': path.resolve(__dirname, 'src/main'),
  '~common': path.resolve(__dirname, 'src/common'),
};
