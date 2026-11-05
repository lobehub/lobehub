import { availableParallelism } from 'node:os';

import type { Browser, Page } from '@playwright/test';

import type { ConditionConfig, ConditionVariant } from '../config';
import type { Side } from '../plan/planFile';
import { caseGapsOf } from './gaps';
import { inspectRules, type RuleInspection } from './inspect';
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
  identical?: string[];
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
  unparsedSelectors: string[];
  widths: number[];
}

export interface CaptureOptions {
  browser: Browser;
  conditions: ConditionConfig;
  onCondition?: (condition: ConditionCapture) => void;
  plan?: PageCondition[];
  states?: readonly CaptureState[];
  urls: Record<Side, string>;
}

const COLLECT = `
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
`;

const CAPTURE_ALL = `(() => {${COLLECT} return result; })()`;

// Custom-property differences are always diagnostic in compareSnapshots, so they carry no verdict weight here.
const CAPTURE_DIGESTS = `(() => {${COLLECT}
  const hash = (text, seed) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  for (const value of Object.values(result)) {
    if ('error' in value) continue;
    value.styles = value.styles.map((style) => {
      const kept = {};
      for (const name in style) if (!name.startsWith('--')) kept[name] = style[name];
      return kept;
    });
  }
  window.__styleEquivalence = result;
  const digests = {};
  for (const [key, value] of Object.entries(result)) {
    if ('error' in value) { digests[key] = value; continue; }
    const text = JSON.stringify({ ...value, durationMs: 0 });
    digests[key] = { digest: hash(text, 1) + ':' + hash(text, 2) + ':' + text.length };
  }
  return digests;
})()`;

export const CONDITION_CONCURRENCY = Math.max(
  1,
  Math.min(4, Math.floor(availableParallelism() / 4)),
);

type Digest = { digest: string } | { error: string };

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

const openPage = async (
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
    return page;
  } catch (error) {
    await page.close();
    throw error;
  }
};

const evaluateOpen = async <T>(
  browser: Browser,
  url: string,
  options: PageCondition,
  pageErrors: string[],
  script: string,
) => {
  const page = await openPage(browser, url, options, pageErrors);
  try {
    return { page, value: (await page.evaluate(script)) as T };
  } catch (error) {
    await page.close();
    throw error;
  }
};

export const capturePage = async (
  browser: Browser,
  url: string,
  options: PageCondition,
  pageErrors: string[],
) => {
  const { page, value } = await evaluateOpen<SectionSnapshots>(
    browser,
    url,
    options,
    pageErrors,
    CAPTURE_ALL,
  );
  return { page, snapshots: value };
};

const sameDigest = (left?: Digest, right?: Digest) =>
  Boolean(left && right && 'digest' in left && 'digest' in right && left.digest === right.digest);

interface DeltaSnapshots {
  reference: Record<string, string>;
  sections: Record<string, SectionSnapshot & { deltas?: Array<Record<string, string | null>> }>;
}

const expand = ({ reference, sections }: DeltaSnapshots): SectionSnapshots =>
  Object.fromEntries(
    Object.entries(sections).map(([key, section]) => {
      if (!('deltas' in section) || !section.deltas) return [key, section];
      const { deltas, ...rest } = section;
      const styles = deltas.map((delta) => {
        const style: Record<string, string> = {};
        for (const name in reference)
          if (!(name in delta)) style[name] = reference[name];
          else if (delta[name] !== null) style[name] = delta[name]!;
        for (const name in delta)
          if (!(name in reference) && delta[name] !== null) style[name] = delta[name]!;
        return style;
      });
      return [key, { ...rest, styles }];
    }),
  );

const snapshotsOf = async (page: Page, keys: string[]): Promise<SectionSnapshots> => {
  if (!keys.length) return {};
  const delta = await page.evaluate((wanted) => {
    const stored = (
      window as unknown as {
        __styleEquivalence: Record<string, { error?: string; styles?: Record<string, string>[] }>;
      }
    ).__styleEquivalence;
    const present = wanted.filter((key) => key in stored);
    const counts = new Map<string, Map<string, number>>();
    for (const key of present)
      for (const style of stored[key].styles ?? [])
        for (const name in style) {
          const values = counts.get(name) ?? new Map<string, number>();
          values.set(style[name], (values.get(style[name]) ?? 0) + 1);
          counts.set(name, values);
        }
    const reference: Record<string, string> = {};
    for (const [name, values] of counts) {
      let best = '';
      let most = 0;
      for (const [value, count] of values)
        if (count > most) {
          best = value;
          most = count;
        }
      reference[name] = best;
    }
    const sections: Record<string, unknown> = {};
    for (const key of present) {
      const { styles, ...rest } = stored[key];
      if (!styles) {
        sections[key] = stored[key];
        continue;
      }
      sections[key] = {
        ...rest,
        deltas: styles.map((style) => {
          const changed: Record<string, string | null> = {};
          for (const name in reference)
            if (!(name in style)) changed[name] = null;
            else if (style[name] !== reference[name]) changed[name] = style[name];
          return changed;
        }),
      };
    }
    return { reference, sections };
  }, keys);
  return expand(delta as DeltaSnapshots);
};

const withDigests = async <T>(
  browser: Browser,
  urls: string[],
  options: PageCondition,
  pageErrors: string[],
  use: (loads: Array<{ page: Page; value: Record<string, Digest> }>) => Promise<T>,
) => {
  const settled = await Promise.allSettled(
    urls.map((url) =>
      evaluateOpen<Record<string, Digest>>(browser, url, options, pageErrors, CAPTURE_DIGESTS),
    ),
  );
  const loads = settled.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
  try {
    const failed = settled.find((item) => item.status === 'rejected');
    if (failed) throw failed.reason;
    return await use(loads);
  } finally {
    await Promise.all(loads.map(({ page }) => page.close()));
  }
};

const splitIdentical = (digests: Array<Record<string, Digest>>) => {
  const keys = [...new Set(digests.flatMap((value) => Object.keys(value)))];
  const identical = keys.filter((key) =>
    digests.every((value) => sameDigest(digests[0][key], value[key])),
  );
  const skipped = new Set(identical);
  return { identical, rest: keys.filter((key) => !skipped.has(key)) };
};

export const captureSections = (
  browser: Browser,
  urls: string[],
  options: PageCondition,
  pageErrors: string[],
) =>
  withDigests(browser, urls, options, pageErrors, async (loads) => {
    const { identical, rest } = splitIdentical(loads.map(({ value }) => value));
    const snapshots = await Promise.all(loads.map(({ page }) => snapshotsOf(page, rest)));
    return { identical, snapshots };
  });

const captureCondition = (
  browser: Browser,
  urls: Record<Side, string>,
  options: PageCondition,
  pageErrors: string[],
): Promise<ConditionCapture> =>
  withDigests(browser, [urls.base, urls.base, urls.head], options, pageErrors, async (loads) => {
    const [base, again, head] = loads;
    const { identical, rest } = splitIdentical([base.value, again.value, head.value]);
    const unstable = rest.filter((key) => !sameDigest(base.value[key], again.value[key]));
    const [baseSnapshots, unstableSnapshots, headSnapshots] = await Promise.all([
      snapshotsOf(base.page, rest),
      snapshotsOf(again.page, unstable),
      snapshotsOf(head.page, rest),
    ]);
    const againSnapshots: SectionSnapshots = {};
    for (const key of rest)
      if (key in unstableSnapshots) againSnapshots[key] = unstableSnapshots[key];
      else if (key in baseSnapshots && key in again.value) againSnapshots[key] = baseSnapshots[key];
    return {
      base: baseSnapshots,
      baseAgain: againSnapshots,
      condition: conditionLabel(options),
      head: headSnapshots,
      identical,
      ...options,
    };
  });

export const conditionFromLabel = (label: string): PageCondition => {
  const [theme, width, state, variant] = label.split('/');
  return {
    state: state as CaptureState,
    theme,
    variant: variant as ConditionVariant | undefined,
    width: Number(width),
  };
};

const captureConditions = async ({
  browser,
  onCondition,
  plan,
  urls,
}: Pick<CaptureOptions, 'browser' | 'onCondition' | 'urls'> & {
  plan: PageCondition[];
}): Promise<RunCapture> => {
  const pageErrors: string[] = [];
  const captures: ConditionCapture[] = [];
  const pending: Array<Promise<ConditionCapture> | undefined> = [];
  const start = () => {
    const index = pending.length;
    if (index >= plan.length) return;
    const task = captureCondition(browser, urls, plan[index], pageErrors);
    task.catch(() => undefined);
    pending.push(task);
  };
  for (let slot = 0; slot < CONDITION_CONCURRENCY; slot++) start();
  for (let index = 0; index < plan.length; index++) {
    const captured = await pending[index]!;
    pending[index] = undefined;
    start();
    if (!onCondition) {
      captures.push(captured);
      continue;
    }
    onCondition(captured);
    captures.push({ ...captured, base: {}, baseAgain: {}, head: {}, identical: [] });
  }
  return {
    conditions: captures,
    containerRules: 0,
    pageErrors,
    unparsedMedia: 0,
    unparsedSelectors: [],
    widths: [...new Set(plan.map((item) => item.width))],
  };
};

const unmodeledRules = (found: RuleInspection) =>
  Object.fromEntries(
    Object.entries(found.unmodeled).map(([section, indices]) => [
      section,
      found.sectionRules?.[section] ?? indices.map((index) => found.rules[index]),
    ]),
  );

export const inspectCaseGaps = async (
  browser: Browser,
  urls: Record<Side, string>,
  options: PageCondition,
  pageErrors: string[],
) => {
  const [base, head] = await Promise.all(
    [urls.base, urls.head].map(async (url) => {
      const page = await openPage(browser, url, { ...options, state: 'default' }, pageErrors);
      try {
        return unmodeledRules(await inspectRules(page));
      } finally {
        await page.close();
      }
    }),
  );
  return caseGapsOf(base, head);
};

export const captureRun = async ({
  browser,
  conditions,
  onCondition,
  plan: fixedPlan,
  states,
  urls,
}: CaptureOptions): Promise<RunCapture> => {
  if (fixedPlan) return captureConditions({ browser, onCondition, plan: fixedPlan, urls });
  const pageErrors: string[] = [];
  const media: string[] = [];
  const pseudoRules: Partial<Record<Side, Record<string, string[]>>> = {};
  const unmodeled: Partial<Record<Side, Record<string, string[]>>> = {};
  let containerRules = 0;
  const unparsedSelectors = new Set<string>();
  for (const side of ['base', 'head'] as const) {
    const page = await openPage(
      browser,
      urls[side],
      { state: 'default', theme: conditions.themes[0], width: conditions.widths[0] },
      pageErrors,
    );
    const found = await inspectRules(page);
    media.push(...found.media);
    pseudoRules[side] = found.pseudoRules;
    unmodeled[side] = unmodeledRules(found);
    containerRules += found.containers;
    for (const selector of found.unparsed) unparsedSelectors.add(selector);
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
  const { conditions: captures, pageErrors: capturedErrors } = await captureConditions({
    browser,
    onCondition,
    plan,
    urls,
  });
  pageErrors.push(...capturedErrors);
  return {
    caseGaps: caseGapsOf(unmodeled.base ?? {}, unmodeled.head ?? {}),
    conditions: captures,
    containerRules,
    pageErrors,
    states: plannedStates,
    unparsedMedia: unparsed,
    unparsedSelectors: [...unparsedSelectors].sort(),
    widths,
  };
};
