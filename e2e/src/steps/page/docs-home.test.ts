import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import enUS from '../../../../locales/en-US/file.json';
import zhCN from '../../../../locales/zh-CN/file.json';
import type { CustomWorld } from '../../support/world';
import { dismissDocsMergeNotice } from './docs-home';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  page = await browser.newPage();
});

afterEach(async () => {
  await page?.close();
});

afterAll(async () => {
  await browser?.close();
});

describe('dismissDocsMergeNotice', () => {
  it.each([
    ['en-US', enUS],
    ['zh-CN', zhCN],
  ] as const)('dismisses the %s notice so the create action is reachable', async (_, locale) => {
    await page.setContent(`
      <button id="create" onclick="this.textContent = 'Created'">Create page</button>
      <dialog open style="position: fixed; inset: 0; width: 100vw; height: 100vh">
        <h2>${locale['docs.mergeNotice.title']}</h2>
        <button onclick="this.closest('dialog').remove()">
          ${locale['docs.mergeNotice.confirm']}
        </button>
      </dialog>
    `);

    await dismissDocsMergeNotice({ page } as CustomWorld, 100);

    expect(await page.getByRole('dialog').count()).toBe(0);
    await page.getByRole('button', { name: 'Create page' }).click({ timeout: 1000 });
    expect(await page.locator('#create').textContent()).toBe('Created');
  });

  it('leaves other dialogs alone when the notice is absent', async () => {
    await page.setContent('<dialog open><h2>Another dialog</h2><button>Got it</button></dialog>');

    await dismissDocsMergeNotice({ page } as CustomWorld, 100);

    expect(await page.getByRole('dialog').count()).toBe(1);
  });
});
