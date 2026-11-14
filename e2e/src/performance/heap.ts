import type { CDPSession, Page } from '@playwright/test';

const round = (value: number) => Math.round(value * 10) / 10;

export const openCdpSession = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  return cdp;
};

/**
 * The page's JS heap in MB after two forced collections, so garbage a reply
 * left behind does not count as growth; only what the app keeps does.
 */
export const collectedHeapMb = async (cdp: CDPSession) => {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const used = metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0;
  return round(used / 1024 / 1024);
};
