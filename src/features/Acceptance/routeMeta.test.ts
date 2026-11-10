import { describe, expect, it } from 'vitest';

import { acceptanceRouteMeta, resolveAcceptanceDynamicTitle } from './routeMeta';

const translate = (key: string) => `translated:${key}`;

describe('resolveAcceptanceDynamicTitle', () => {
  it('prefers the report subject title once loaded', () => {
    expect(resolveAcceptanceDynamicTitle('Checkout flow', 'acc_1', translate)).toBe(
      'Checkout flow',
    );
  });

  it('falls back to the translated label while the report is still loading', () => {
    expect(resolveAcceptanceDynamicTitle(undefined, 'acc_1', translate)).toBe(
      'translated:acceptance.titleFallback',
    );
  });

  // Regression: routes without an `:acceptanceId` (e.g. the project acceptance
  // section while it reused this meta) must not publish the fallback — it would
  // pin every such tab to the same static label in the tab cache.
  it('publishes no fallback title without an acceptanceId', () => {
    expect(resolveAcceptanceDynamicTitle(undefined, undefined, translate)).toBeUndefined();
  });
});

describe('acceptanceRouteMeta', () => {
  it('keeps a static title key so id-less routes still have a label', () => {
    expect(acceptanceRouteMeta.titleKey).toBe('verify:acceptance.titleFallback');
    expect(acceptanceRouteMeta.DynamicMeta).toBeDefined();
  });
});
