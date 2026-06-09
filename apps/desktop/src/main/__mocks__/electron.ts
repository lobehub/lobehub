/**
 * Default global `electron` mock (registered in `setup.ts`).
 *
 * Provides a fully-formed `app` (paths + readiness) plus light stubs for the
 * other commonly-imported namespaces. The point is that modules which touch
 * electron at import time — notably `@/const/dir`'s eager `app.getAppPath()` /
 * `app.getPath('userData')` — can be imported from ANY test without each suite
 * re-stubbing these basics. This keeps production code free to use plain
 * value-style path constants instead of lazy getter functions.
 *
 * Test files that need specific behavior still declare their own
 * `vi.mock('electron', …)`, which takes precedence per-file over this default.
 */
import { vi } from 'vitest';

export const app = {
  getAppPath: vi.fn(() => '/mock/app'),
  getLocale: vi.fn(() => 'en-US'),
  getName: vi.fn(() => 'LobeHub'),
  getPath: vi.fn((name: string) => `/mock/${name}`),
  getVersion: vi.fn(() => '0.0.0-test'),
  isPackaged: false,
  on: vi.fn(),
  quit: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  setName: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
};

export const BrowserWindow = Object.assign(vi.fn(), {
  getAllWindows: vi.fn(() => []),
  getFocusedWindow: vi.fn(() => null),
});

export const Menu = {
  buildFromTemplate: vi.fn(() => ({})),
  setApplicationMenu: vi.fn(),
};

export const ipcMain = { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() };

export const shell = {
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve('')),
};

export const dialog = { showMessageBox: vi.fn(), showOpenDialog: vi.fn() };

export const nativeTheme = { on: vi.fn(), shouldUseDarkColors: false, themeSource: 'system' };

export const protocol = { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() };

export const clipboard = { readText: vi.fn(() => ''), writeText: vi.fn() };

export const nativeImage = { createEmpty: vi.fn(), createFromPath: vi.fn() };

export default {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  shell,
};
