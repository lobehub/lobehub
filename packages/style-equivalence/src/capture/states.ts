import type { Page } from '@playwright/test';

export const STATES = ['default', 'hover-chain', 'hover-target', 'focus-visible'] as const;
export type CaptureState = (typeof STATES)[number] | `force-chain:${string}` | `force:${string}`;

const TARGETS = '[data-case] [data-synthetic-element]:not(:has([data-synthetic-element]))';
const CHAIN = '[data-case] [data-synthetic-element]';

const forcing = (state: Exclude<CaptureState, 'default'>) => {
  if (state === 'hover-chain') return { pseudos: ['hover'], selector: CHAIN };
  if (state === 'hover-target') return { pseudos: ['hover'], selector: TARGETS };
  if (state === 'focus-visible') return { pseudos: ['focus-visible'], selector: TARGETS };
  const [mode, list] = state.split(':');
  return { pseudos: list.split('+'), selector: mode === 'force-chain' ? CHAIN : TARGETS };
};

const differs = (left: string[] = [], right: string[] = []) =>
  [...new Set(left)].sort().join('\n') !== [...new Set(right)].sort().join('\n');

export const planStates = (
  base: Record<string, string[]>,
  head: Record<string, string[]>,
): CaptureState[] => {
  const extra = new Set<CaptureState>();
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (!differs(base[key], head[key])) continue;
    if (key.startsWith('chain:')) {
      const states = key.slice('chain:'.length);
      if (states !== 'hover') extra.add(`force-chain:${states}`);
      continue;
    }
    if (key === 'hover' || key === 'focus-visible') continue;
    extra.add(key === 'focus-within' ? 'force-chain:focus-within' : `force:${key}`);
  }
  return [...STATES, ...[...extra].sort()];
};

export const applyState = async (page: Page, state: CaptureState) => {
  if (state === 'default') return;
  const { pseudos, selector } = forcing(state);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
  for (const nodeId of nodeIds)
    await cdp.send('CSS.forcePseudoState', { forcedPseudoClasses: pseudos, nodeId });
};
