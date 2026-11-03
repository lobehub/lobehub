import type { Page } from '@playwright/test';

export const STATES = ['default', 'hover-chain', 'hover-target', 'focus-visible'] as const;
export type CaptureState = (typeof STATES)[number];

const SELECTORS: Record<Exclude<CaptureState, 'default'>, { pseudo: string; selector: string }> = {
  'focus-visible': {
    pseudo: 'focus-visible',
    selector: '[data-case] [data-synthetic-element]:not(:has([data-synthetic-element]))',
  },
  'hover-chain': { pseudo: 'hover', selector: '[data-case] [data-synthetic-element]' },
  'hover-target': {
    pseudo: 'hover',
    selector: '[data-case] [data-synthetic-element]:not(:has([data-synthetic-element]))',
  },
};

export const applyState = async (page: Page, state: CaptureState) => {
  if (state === 'default') return;
  const { pseudo, selector } = SELECTORS[state];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
  for (const nodeId of nodeIds)
    await cdp.send('CSS.forcePseudoState', { forcedPseudoClasses: [pseudo], nodeId });
};
