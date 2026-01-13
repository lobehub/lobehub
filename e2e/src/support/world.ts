import { IWorldOptions, World, setWorldConstructor } from '@cucumber/cucumber';
import { Browser, BrowserContext, Page, Response, chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Default timeout for waiting operations (e.g., waitForURL, toBeVisible)
 */
export const WAIT_TIMEOUT = 13_000;

export interface TestContext {
  [key: string]: any;
  consoleErrors: string[];
  jsErrors: Error[];
  lastResponse?: Response | null;
  previousUrl?: string;
}

export class CustomWorld extends World {
  browser!: Browser;
  browserContext!: BrowserContext;
  page!: Page;
  testContext: TestContext;

  /**
   * Get the platform-specific modifier key (Meta for macOS, Control for Linux/Windows)
   */
  get modKey(): 'Meta' | 'Control' {
    return process.platform === 'darwin' ? 'Meta' : 'Control';
  }

  constructor(options: IWorldOptions) {
    super(options);
    this.testContext = {
      consoleErrors: [],
      jsErrors: [],
    };
  }

  // Getter for easier access
  get context(): TestContext {
    return this.testContext;
  }

  async init() {
    const PORT = process.env.PORT ? Number(process.env.PORT) : 3006;
    const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

    this.browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
    });

    this.browserContext = await this.browser.newContext({
      baseURL: BASE_URL,
      viewport: { height: 720, width: 1280 },
    });

    // Set expect timeout for assertions (e.g., toBeVisible, toHaveText)
    this.browserContext.setDefaultTimeout(30_000);

    this.page = await this.browserContext.newPage();

    // Set up error listeners
    this.page.on('pageerror', (error) => {
      this.testContext.jsErrors.push(error);
      console.error('Page error:', error.message);
    });

    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.testContext.consoleErrors.push(msg.text());
      }
    });

    this.page.setDefaultTimeout(30_000);
  }

  async cleanup() {
    await this.page?.close();
    await this.browserContext?.close();
    await this.browser?.close();
  }

  async takeScreenshot(name: string): Promise<Buffer> {
    const screenshot = await this.page.screenshot({ fullPage: true });

    // Save screenshot to file
    const screenshotsDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    const filepath = path.join(screenshotsDir, `${name}.png`);
    fs.writeFileSync(filepath, screenshot);
    console.log(`📸 Screenshot saved: ${filepath}`);

    return screenshot;
  }
}

setWorldConstructor(CustomWorld);
