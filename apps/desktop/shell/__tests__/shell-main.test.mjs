import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mainPath = fileURLToPath(new URL('../main.js', import.meta.url));
const require = createRequire(mainPath);
const electronPath = require.resolve('electron');

let tmp;
let resourcesPath;

const loadMain = (app) => {
  require.cache[electronPath] = { exports: { app }, id: electronPath, loaded: true };
  delete require.cache[mainPath];
  require(mainPath);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-main-'));
  resourcesPath = process.resourcesPath;
  process.resourcesPath = path.join(tmp, 'resources');
});

afterEach(() => {
  delete require.cache[electronPath];
  delete require.cache[mainPath];
  process.resourcesPath = resourcesPath;
  fs.rmSync(tmp, { force: true, recursive: true });
});

describe('shell main', () => {
  it('exits a secondary instance before touching core OTA boot state', () => {
    const userData = path.join(tmp, 'userData');
    const app = {
      exit: vi.fn(),
      getPath: vi.fn(() => userData),
      getVersion: () => '1.0.0',
      isPackaged: true,
      requestSingleInstanceLock: vi.fn(() => false),
    };

    loadMain(app);

    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.getPath).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(userData, 'core-ota', 'boot.json'))).toBe(false);
  });
});
