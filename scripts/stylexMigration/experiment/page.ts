import type { Browser } from '@playwright/test';

/** Hermetic component host: never access production or download remote fonts/assets. */
export const openFixturePage = async (browser: Browser, origin: string, side: string) => {
  const page = await browser.newPage({ viewport: { height: 900, width: 1200 } });
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await page.goto(`${origin}/${side}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-experiment-ready]', { state: 'attached', timeout: 10_000 });
  return page;
};
