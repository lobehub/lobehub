import { describe, expect, it } from 'vitest';

import { findRouteTitleKey } from './routeTitle';

describe('findRouteTitleKey', () => {
  it('takes the deepest route that declares a title', () => {
    expect(
      findRouteTitleKey([
        { meta: { titleKey: 'navigation.memory' } },
        { meta: {} },
        { meta: { titleKey: 'navigation.memoryIdentities' } },
        undefined,
      ]),
    ).toBe('navigation.memoryIdentities');
  });

  it('is undefined when no route in the chain has a title', () => {
    expect(findRouteTitleKey([undefined, { meta: {} }, { other: true }])).toBeUndefined();
  });
});
