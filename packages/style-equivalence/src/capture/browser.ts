import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';

const CACHE = path.join(homedir(), 'Library/Caches/ms-playwright');
const SHELL = 'chrome-headless-shell-mac-arm64/chrome-headless-shell';

export const resolveBrowserExecutable = () => {
  if (process.env.STYLE_EQ_BROWSER) return process.env.STYLE_EQ_BROWSER;
  if (!existsSync(CACHE)) return undefined;
  const shells = readdirSync(CACHE)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((name) => path.join(CACHE, name, SHELL))
    .filter((file) => existsSync(file));
  return shells[0];
};

export const launchBrowser = () =>
  chromium.launch({ executablePath: resolveBrowserExecutable(), headless: true });
