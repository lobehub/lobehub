import { describe, expect, it } from 'vitest';

import {
  acceptanceChecksLayout,
  acceptanceContentLayout,
  acceptanceReadingColumnMaxWidth,
  getAcceptanceBodyMaxWidth,
} from './layout';

describe('acceptance column widths', () => {
  it('fits the header to the checklist width', () => {
    expect(acceptanceReadingColumnMaxWidth - 2 * acceptanceContentLayout.paddingInline).toBe(
      acceptanceChecksLayout.maxWidth,
    );
  });

  it('gives the wide frame to the discussion body only', () => {
    expect(getAcceptanceBodyMaxWidth('discussion')).toBe(acceptanceContentLayout.maxWidth);
  });

  it.each(['checks', 'resources'])('keeps the %s body at the header width', (tab) => {
    expect(getAcceptanceBodyMaxWidth(tab)).toBe(acceptanceReadingColumnMaxWidth);
  });
});

describe('acceptanceChecksLayout', () => {
  it('keeps the checklist narrower than the discussion frame', () => {
    expect(acceptanceChecksLayout.maxWidth).toBeLessThan(acceptanceContentLayout.maxWidth);
  });
});
