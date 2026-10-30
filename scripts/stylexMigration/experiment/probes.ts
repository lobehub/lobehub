import type { Page } from '@playwright/test';

import type { RuleInventory, StyleDifference, StyleSnapshot } from './capture';
import { captureInPage, compareSnapshots, inventoryInPage } from './capture';
import { createFastCapture } from './fastCapture';
import { createWitness } from './witness';

export interface Probe {
  animationTime?: number;
  containers?: Array<{ index: number; width: number }>;
  direction?: 'ltr' | 'rtl';
  forced?: { index: number; states: string[] };
  id: string;
  reducedMotion?: 'reduce' | 'no-preference';
  styleContainer?: { index: number; property: string; value: string };
  theme?: 'dark' | 'light';
  viewportWidth?: number;
}

export interface ProbePlan {
  inventories: RuleInventory[];
  probes: Probe[];
  unsupported: string[];
}

const forceable = ['hover', 'active', 'focus-visible', 'focus-within', 'focus'];
const numericWidths = (condition: string) =>
  [
    ...condition.matchAll(
      /(?:min-|max-)?(?:width|inline-size)\s*(?::|[<>=]{1,2})\s*(\d+(?:\.\d+)?)px/g,
    ),
    ...condition.matchAll(/(\d+(?:\.\d+)?)px\s*[<>=]{1,2}\s*(?:width|inline-size)/g),
  ].map((match) => Number(match[1]));

export const discoverProbes = async (
  pages: Page[],
  options: { extraEnvironments?: boolean; maxProbes?: number } = {},
): Promise<ProbePlan> => {
  const inventories = await Promise.all(
    pages.map((page) => page.evaluate(inventoryInPage, '[data-case-root]')),
  );
  const unsupported = new Set(inventories.flatMap((inventory) => inventory.unsupported));
  const probes: Probe[] = [{ id: 'default' }];
  const seen = new Set<string>();
  const add = (probe: Probe) => {
    const signature = JSON.stringify({ ...probe, id: undefined });
    if (!seen.has(signature)) {
      seen.add(signature);
      probes.push(probe);
    }
  };
  if (options.extraEnvironments !== false) {
    add({ id: 'dark', theme: 'dark' });
    add({ direction: 'rtl', id: 'rtl' });
  }
  const mediaWidths = new Set<number>();
  const containerWidths = new Map<string, { condition: string; widths: number[] }>();
  const allConditions = new Map(
    inventories
      .flatMap((inventory) => inventory.conditions)
      .map((entry) => [`${entry.kind}:${entry.condition}`, entry]),
  );
  for (const entry of allConditions.values()) {
    if (entry.kind === 'CSSMediaRule') {
      numericWidths(entry.condition).forEach((width) => mediaWidths.add(width));
      if (entry.condition.includes('prefers-reduced-motion'))
        add({ id: 'reduced-motion', reducedMotion: 'reduce' });
      if (entry.condition.includes('prefers-color-scheme'))
        add({ id: 'dark-media', theme: 'dark' });
      if (
        !numericWidths(entry.condition).length &&
        !/prefers-reduced-motion|prefers-color-scheme|\(hover: hover\)/.test(entry.condition)
      )
        unsupported.add(`media:${entry.condition}`);
    } else if (entry.kind === 'CSSContainerRule') {
      const widths = numericWidths(entry.condition);
      if (widths.length)
        containerWidths.set(entry.condition, { condition: entry.condition, widths });
      else {
        const literalStyle = entry.condition.match(
          /^(?:([\w-]+)\s+)?style\(\s*(--[\w-]+)\s*:\s*([\w.-]+)\s*\)$/,
        );
        if (!literalStyle) {
          unsupported.add(`container:${entry.condition}`);
          continue;
        }
        let found = false;
        for (let side = 0; side < pages.length; side++) {
          const targets = inventories[side].selectors
            .filter((selector) =>
              selector.conditions.some(
                (condition) =>
                  condition.kind === entry.kind && condition.condition === entry.condition,
              ),
            )
            .flatMap((selector) => selector.targets);
          const indices = await pages[side].evaluate(
            ({ name, targets }) => {
              const result = new Set<number>();
              for (const target of targets) {
                let parent = document.querySelector(
                  `[data-experiment-node="${target}"]`,
                )?.parentElement;
                while (parent?.hasAttribute('data-experiment-node')) {
                  if (!name || getComputedStyle(parent).containerName.split(' ').includes(name)) {
                    result.add(Number(parent.getAttribute('data-experiment-node')));
                    break;
                  }
                  parent = parent.parentElement;
                }
              }
              return [...result];
            },
            { name: literalStyle[1], targets },
          );
          for (const index of indices) {
            found = true;
            add({
              id: `style-container-${index}-${literalStyle[2]}-${literalStyle[3]}`,
              styleContainer: { index, property: literalStyle[2], value: literalStyle[3] },
            });
          }
        }
        if (!found) unsupported.add(`style-container-not-found:${entry.condition}`);
      }
    } else if (entry.kind === 'CSSSupportsRule') {
      if (!(await pages[0].evaluate((condition) => CSS.supports(condition), entry.condition)))
        unsupported.add(`inactive-supports:${entry.condition}`);
    } else unsupported.add(`condition:${entry.kind}:${entry.condition}`);
  }
  for (const width of mediaWidths)
    for (const delta of [-1, 0, 1])
      add({ id: `viewport-${width + delta}`, viewportWidth: Math.max(1, width + delta) });
  for (const { condition, widths } of containerWidths.values()) {
    const name = condition.match(/^([\w-]+)\s+\(/)?.[1];
    const indices = new Set<number>();
    for (let side = 0; side < pages.length; side++) {
      const inventory = inventories[side];
      const selectors =
        inventory.conditions.find(
          (entry) => entry.kind === 'CSSContainerRule' && entry.condition === condition,
        )?.selectors ?? [];
      const targets = inventory.selectors
        .filter((entry) => selectors.includes(entry.selector))
        .flatMap((entry) => entry.targets);
      const containers = await pages[side].evaluate(
        ({ name, targets }) => {
          const result = new Set<number>();
          for (const index of targets) {
            let element = document.querySelector(
              `[data-experiment-node="${index}"]`,
            )?.parentElement;
            while (element) {
              const style = getComputedStyle(element);
              if (
                ['inline-size', 'size'].includes(style.containerType) &&
                (!name || style.containerName.split(' ').includes(name))
              ) {
                const containerIndex = element.getAttribute('data-experiment-node');
                if (containerIndex !== null) result.add(Number(containerIndex));
                break;
              }
              element = element.parentElement;
            }
          }
          return [...result];
        },
        { name, targets },
      );
      containers.forEach((index) => indices.add(index));
    }
    if (indices.size === 0) unsupported.add(`container-not-found:${condition}`);
    for (const index of indices)
      for (const width of widths)
        for (const delta of [-1, 0, 1])
          add({
            containers: [{ index, width: Math.max(1, width + delta) }],
            id: `container-${index}-${width + delta}`,
          });
  }
  // A bounded cross-product covers the common nested media + container case.
  const viewportProbes = probes.filter((probe) => probe.viewportWidth !== undefined);
  const containerProbes = probes.filter((probe) => probe.containers?.length);
  if (viewportProbes.length * containerProbes.length <= 24)
    for (const viewport of viewportProbes)
      for (const container of containerProbes)
        add({
          containers: container.containers,
          id: `${viewport.id}+${container.id}`,
          viewportWidth: viewport.viewportWidth,
        });
  else if (viewportProbes.length && containerProbes.length)
    unsupported.add('condition-product-budget');
  const states = new Set<string>();
  const targetSet = new Set<number>();
  for (let side = 0; side < pages.length; side++) {
    const inventory = inventories[side];
    for (const entry of inventory.selectors) {
      const matches = [
        ...entry.selector.matchAll(/:(hover|active|focus-visible|focus-within|focus)(?![\w-])/g),
      ].map((match) => match[1]);
      matches.forEach((state) => states.add(state));
      if (matches.length) {
        const ancestors = await pages[side].evaluate(
          ({ exhaustive, targets }) => {
            if (exhaustive)
              return [...document.querySelectorAll('[data-experiment-node]')].map((element) =>
                Number(element.getAttribute('data-experiment-node')),
              );
            const result = new Set<number>();
            for (const index of targets) {
              let element = document.querySelector(`[data-experiment-node="${index}"]`);
              while (element?.hasAttribute('data-experiment-node')) {
                result.add(Number(element.getAttribute('data-experiment-node')));
                element = element.parentElement;
              }
            }
            return [...result];
          },
          { exhaustive: /[+~]|:has\(/.test(entry.selector), targets: entry.targets },
        );
        ancestors.forEach((index) => targetSet.add(index));
      }
      if (matches.length > 1) {
        for (const index of entry.targets)
          add({
            forced: { index, states: [...new Set(matches)] },
            id: `combined-${matches.join('-')}-${index}`,
          });
      }
    }
  }
  for (const state of forceable.filter((state) => states.has(state)))
    for (const index of targetSet)
      add({ forced: { index, states: [state] }, id: `${state}-${index}` });
  // Conditional interactions must run inside the condition, not just at desktop width.
  const conditionedInteraction = inventories.some((inventory) =>
    inventory.selectors.some(
      (entry) =>
        entry.conditions.length &&
        /:(?:hover|active|focus-visible|focus-within|focus)\b/.test(entry.selector),
    ),
  );
  if (conditionedInteraction) {
    const environments = probes.filter(
      (probe) =>
        probe.viewportWidth !== undefined || probe.containers || probe.reducedMotion || probe.theme,
    );
    const interactions = probes.filter((probe) => probe.forced);
    for (const environment of environments)
      for (const interaction of interactions)
        add({ ...environment, ...interaction, id: `${environment.id}+${interaction.id}` });
  }
  const hasAnimations = await pages[0].evaluate(() =>
    document.getAnimations().some((animation) => animation instanceof CSSAnimation),
  );
  if (hasAnimations)
    for (const animationTime of [450, 900])
      add({ animationTime, id: `animation-${animationTime}ms` });
  const maxProbes = options.maxProbes ?? 160;
  if (probes.length > maxProbes) {
    unsupported.add(`probe-budget:${probes.length}>${maxProbes}`);
    probes.length = maxProbes;
  }
  return { inventories, probes, unsupported: [...unsupported] };
};

export const createProbeDriver = async (page: Page, selector = '[data-case-root]') => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const nodeIds = new Map<number, number>();
  let forcedNode: number | undefined;
  await page.evaluate((selector) => {
    const root = document.querySelector(selector)!;
    const entries = [root, ...root.querySelectorAll('*')].map(
      (element) => [element, element.getAttribute('style')] as const,
    );
    Object.assign(window, {
      __restoreExperimentStyles: () => {
        for (const [element, value] of entries)
          value === null ? element.removeAttribute('style') : element.setAttribute('style', value);
      },
    });
  }, selector);
  const readNode = async (index: number) => {
    const known = nodeIds.get(index);
    if (known) return known;
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `[data-experiment-node="${index}"]`,
    });
    if (!nodeId) throw new Error(`Missing probe target ${index}`);
    nodeIds.set(index, nodeId);
    return nodeId;
  };
  return {
    cdp,
    async apply(probe: Probe) {
      if (forcedNode)
        await cdp.send('CSS.forcePseudoState', { forcedPseudoClasses: [], nodeId: forcedNode });
      forcedNode = undefined;
      await page.setViewportSize({ height: 900, width: probe.viewportWidth ?? 1200 });
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: probe.reducedMotion ?? 'no-preference' },
          { name: 'prefers-color-scheme', value: probe.theme ?? 'light' },
        ],
      });
      await page.evaluate((probe) => {
        (
          window as unknown as { __restoreExperimentStyles: () => void }
        ).__restoreExperimentStyles();
        document.documentElement.dataset.theme = probe.theme ?? 'light';
        document.documentElement.dir = probe.direction ?? 'ltr';
        for (const container of probe.containers ?? []) {
          const element = document.querySelector<HTMLElement>(
            `[data-experiment-node="${container.index}"]`,
          );
          if (!element) throw new Error(`Missing container ${container.index}`);
          element.style.width = `${container.width}px`;
        }
        if (probe.styleContainer) {
          const container = probe.styleContainer;
          document
            .querySelector<HTMLElement>(`[data-experiment-node="${container.index}"]`)!
            .style.setProperty(container.property, container.value);
        }
      }, probe);
      if (probe.forced) {
        forcedNode = await readNode(probe.forced.index);
        await cdp.send('CSS.forcePseudoState', {
          forcedPseudoClasses: probe.forced.states,
          nodeId: forcedNode,
        });
      }
      // Computed style forces style/layout synchronously; rAF can stall in background headless-shell tabs.
      await page.evaluate(() => document.documentElement.getBoundingClientRect().width);
    },
    async dispose() {
      if (forcedNode)
        await cdp.send('CSS.forcePseudoState', { forcedPseudoClasses: [], nodeId: forcedNode });
      await page.evaluate(() =>
        (
          window as unknown as { __restoreExperimentStyles: () => void }
        ).__restoreExperimentStyles(),
      );
      await cdp.detach();
    },
  };
};

export interface ProbeResult {
  differenceCount: number;
  differences: StyleDifference[];
  durationMs: number;
  id: string;
  propertyReads: number;
}

export const compareWithProbes = async (
  pages: Page[],
  plan: ProbePlan,
  backend: 'strict' | 'fast' = 'strict',
) => {
  const drivers = await Promise.all(pages.map((page) => createProbeDriver(page)));
  const witnesses = await Promise.all(
    pages.map((page, index) => createWitness(page, plan.inventories[index])),
  );
  const fastCollectors =
    backend === 'fast'
      ? await Promise.all(pages.map((page, index) => createFastCapture(page, drivers[index].cdp)))
      : undefined;
  const results: ProbeResult[] = [];
  let baseline: StyleSnapshot[] = [];
  try {
    for (const probe of plan.probes) {
      const started = performance.now();
      await Promise.all(drivers.map((driver) => driver.apply(probe)));
      const snapshots = await Promise.all(
        pages.map((page, index) =>
          fastCollectors
            ? fastCollectors[index](probe.animationTime)
            : page.evaluate(captureInPage, { animationTime: probe.animationTime }),
        ),
      );
      if (probe.id === 'default') baseline = snapshots;
      const differences = compareSnapshots(snapshots[0], snapshots[1]);
      await Promise.all(witnesses.map((witness) => witness.collect()));
      results.push({
        differenceCount: differences.length,
        differences,
        durationMs: performance.now() - started,
        id: probe.id,
        propertyReads: snapshots.reduce((sum, snapshot) => sum + snapshot.propertyReads, 0),
      });
    }
  } finally {
    await Promise.all(drivers.map((driver) => driver.dispose()));
    await Promise.all(witnesses.map((witness) => witness.dispose()));
  }
  const coverage = witnesses.map((witness) => witness.report());
  return { baseline, coverage, results };
};
