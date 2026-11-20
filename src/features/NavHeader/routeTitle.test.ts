import { describe, expect, it } from 'vitest';

import { findRouteTitleKey, getRouteTitleNamespaces } from './routeTitle';

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

describe('getRouteTitleNamespaces', () => {
  it('loads the namespace a prefixed title names', () => {
    expect(getRouteTitleNamespaces('project:sections.home')).toEqual(['electron', 'project']);
  });

  it('defaults to the electron namespace', () => {
    expect(getRouteTitleNamespaces('navigation.memory')).toEqual(['electron']);
    expect(getRouteTitleNamespaces(undefined)).toEqual(['electron']);
  });
});
