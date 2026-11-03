import type { Browser } from '@playwright/test';

import type { ConditionConfig } from '../config';
import type { Side } from '../plan/planFile';
import { captureInPage, type StyleSnapshot } from './snapshot';
import { applyState, type CaptureState, STATES } from './states';
import { planWidths, readMediaConditions } from './widths';

export type SectionSnapshot = StyleSnapshot | { error: string };
export type SectionSnapshots = Record<string, SectionSnapshot>;

export interface ConditionCapture {
  base: SectionSnapshots;
  baseAgain: SectionSnapshots;
  condition: string;
  head: SectionSnapshots;
  state: CaptureState;
  theme: string;
  width: number;
}

export interface RunCapture {
  conditions: ConditionCapture[];
  containerRules: number;
  pageErrors: string[];
  unparsedMedia: number;
  widths: number[];
}

export interface CaptureOptions {
  browser: Browser;
  conditions: ConditionConfig;
  states?: readonly CaptureState[];
  urls: Record<Side, string>;
}

const CAPTURE_ALL = `(() => {
  const __name = (target) => target;
  const capture = ${captureInPage.toString()};
  const result = {};
  for (const section of document.querySelectorAll('[data-case]')) {
    const key = section.getAttribute('data-case');
    const failure = section.querySelector('[data-synthetic-error]');
    if (failure) { result[key] = { error: failure.getAttribute('data-synthetic-error') }; continue; }
    try { result[key] = capture({ selector: '[data-case="' + CSS.escape(key) + '"]' }); }
    catch (error) { result[key] = { error: String((error && error.message) || error) }; }
  }
  return result;
})()`;

const withTheme = (url: string, theme: string) => {
  const target = new URL(url);
  target.searchParams.set('theme', theme);
  return target.toString();
};

export const capturePage = async (
  browser: Browser,
  url: string,
  options: { state: CaptureState; theme: string; width: number },
  pageErrors: string[],
) => {
  const page = await browser.newPage({ viewport: { height: 900, width: options.width } });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(withTheme(url, options.theme));
    await page.waitForSelector('[data-synthetic-ready]', { state: 'attached', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await applyState(page, options.state);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    return { page, snapshots: (await page.evaluate(CAPTURE_ALL)) as SectionSnapshots };
  } catch (error) {
    await page.close();
    throw error;
  }
};

export const captureRun = async ({
  browser,
  conditions,
  states = STATES,
  urls,
}: CaptureOptions): Promise<RunCapture> => {
  const pageErrors: string[] = [];
  const media: string[] = [];
  let containerRules = 0;
  for (const side of ['base', 'head'] as const) {
    const { page } = await capturePage(
      browser,
      urls[side],
      { state: 'default', theme: conditions.themes[0], width: conditions.widths[0] },
      pageErrors,
    );
    const found = await readMediaConditions(page);
    media.push(...found.media);
    containerRules += found.containers;
    await page.close();
  }
  const { unparsed, widths } = planWidths(media, conditions.widths);
  const captures: ConditionCapture[] = [];
  for (const theme of conditions.themes)
    for (const width of widths)
      for (const state of states) {
        const options = { state, theme, width };
        const loads = await Promise.all([
          capturePage(browser, urls.base, options, pageErrors),
          capturePage(browser, urls.base, options, pageErrors),
          capturePage(browser, urls.head, options, pageErrors),
        ]);
        await Promise.all(loads.map(({ page }) => page.close()));
        captures.push({
          base: loads[0].snapshots,
          baseAgain: loads[1].snapshots,
          condition: `${theme}/${width}/${state}`,
          head: loads[2].snapshots,
          state,
          theme,
          width,
        });
      }
  return { conditions: captures, containerRules, pageErrors, unparsedMedia: unparsed, widths };
};
