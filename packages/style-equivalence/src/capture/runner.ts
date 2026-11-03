import type { Browser } from '@playwright/test';

import type { ConditionConfig, ConditionVariant } from '../config';
import type { Side } from '../plan/planFile';
import { caseGapsOf } from './gaps';
import { inspectRules } from './inspect';
import { captureInPage, type StyleSnapshot } from './snapshot';
import { applyState, type CaptureState, planStates } from './states';
import { planWidths } from './widths';

export const DEFAULT_VARIANTS: ConditionVariant[] = ['rtl', 'reduced-motion'];

export type SectionSnapshot = (StyleSnapshot & { targetKey?: string }) | { error: string };
export type SectionSnapshots = Record<string, SectionSnapshot>;

export interface ConditionCapture {
  base: SectionSnapshots;
  baseAgain: SectionSnapshots;
  condition: string;
  head: SectionSnapshots;
  state: CaptureState;
  theme: string;
  variant?: ConditionVariant;
  width: number;
}

export interface RunCapture {
  caseGaps?: Record<string, string[]>;
  conditions: ConditionCapture[];
  containerRules: number;
  pageErrors: string[];
  states?: CaptureState[];
  unparsedMedia: number;
  widths: number[];
}

export interface CaptureOptions {
  browser: Browser;
  conditions: ConditionConfig;
  onCondition?: (condition: ConditionCapture) => void;
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
    const skip = (element) => ['LINK', 'META', 'SCRIPT', 'STYLE'].includes(element.tagName);
    const keyOf = (target) => {
      const path = [];
      for (let node = target; node && node !== section; node = node.parentElement)
        path.unshift([...node.parentElement.children].filter((child) => !skip(child)).indexOf(node));
      return ['root', ...path].join('.');
    };
    const marked = section.querySelector('[data-synthetic-target]');
    const targets = marked ? [marked] : [...section.querySelectorAll('[data-synthetic-element]')].filter((node) => !node.querySelector('[data-synthetic-element]'));
    try { result[key] = { ...capture({ selector: '[data-case="' + CSS.escape(key) + '"]' }), targetKey: targets[0] ? keyOf(targets[0]) : 'root' }; }
    catch (error) { result[key] = { error: String((error && error.message) || error) }; }
  }
  return result;
})()`;

export interface PageCondition {
  state: CaptureState;
  theme: string;
  variant?: ConditionVariant;
  width: number;
}

const urlFor = (url: string, { theme, variant }: PageCondition) => {
  const target = new URL(url);
  target.searchParams.set('theme', theme);
  if (variant === 'rtl') target.searchParams.set('dir', 'rtl');
  return target.toString();
};

export const conditionLabel = ({ state, theme, variant, width }: PageCondition) =>
  [theme, width, state, variant].filter((part) => part !== undefined).join('/');

export const capturePage = async (
  browser: Browser,
  url: string,
  options: PageCondition,
  pageErrors: string[],
) => {
  const page = await browser.newPage({
    reducedMotion: options.variant === 'reduced-motion' ? 'reduce' : 'no-preference',
    viewport: { height: 900, width: options.width },
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(urlFor(url, options));
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
  onCondition,
  states,
  urls,
}: CaptureOptions): Promise<RunCapture> => {
  const pageErrors: string[] = [];
  const media: string[] = [];
  const pseudoRules: Partial<Record<Side, Record<string, string[]>>> = {};
  const unmodeled: Partial<Record<Side, Record<string, string[]>>> = {};
  let containerRules = 0;
  for (const side of ['base', 'head'] as const) {
    const { page } = await capturePage(
      browser,
      urls[side],
      { state: 'default', theme: conditions.themes[0], width: conditions.widths[0] },
      pageErrors,
    );
    const found = await inspectRules(page);
    media.push(...found.media);
    pseudoRules[side] = found.pseudoRules;
    unmodeled[side] = Object.fromEntries(
      Object.entries(found.unmodeled).map(([section, indices]) => [
        section,
        indices.map((index) => found.rules[index]),
      ]),
    );
    containerRules += found.containers;
    await page.close();
  }
  const { unparsed, widths } = planWidths(media, conditions.widths);
  const plannedStates = states
    ? [...states]
    : planStates(pseudoRules.base ?? {}, pseudoRules.head ?? {});
  const plan: PageCondition[] = [];
  for (const theme of conditions.themes)
    for (const width of widths)
      for (const state of plannedStates) plan.push({ state, theme, width });
  for (const variant of conditions.variants ?? DEFAULT_VARIANTS)
    plan.push({
      state: 'default',
      theme: conditions.themes[0],
      variant,
      width: conditions.widths.at(-1)!,
    });
  const captures: ConditionCapture[] = [];
  for (const options of plan) {
    const loads = await Promise.all([
      capturePage(browser, urls.base, options, pageErrors),
      capturePage(browser, urls.base, options, pageErrors),
      capturePage(browser, urls.head, options, pageErrors),
    ]);
    await Promise.all(loads.map(({ page }) => page.close()));
    const captured: ConditionCapture = {
      base: loads[0].snapshots,
      baseAgain: loads[1].snapshots,
      condition: conditionLabel(options),
      head: loads[2].snapshots,
      ...options,
    };
    if (!onCondition) {
      captures.push(captured);
      continue;
    }
    onCondition(captured);
    captures.push({ ...captured, base: {}, baseAgain: {}, head: {} });
  }
  return {
    caseGaps: caseGapsOf(unmodeled.base ?? {}, unmodeled.head ?? {}),
    conditions: captures,
    containerRules,
    pageErrors,
    states: plannedStates,
    unparsedMedia: unparsed,
    widths,
  };
};
