import { describe, expect, it } from 'vitest';

import { resolveSidebarItemVisibility } from './useSidebarItemVisibility';

const options = (overrides: Partial<Parameters<typeof resolveSidebarItemVisibility>[1]> = {}) => ({
  hiddenItemIds: new Set<string>(),
  visibilityOverrides: {},
  ...overrides,
});

describe('resolveSidebarItemVisibility', () => {
  // Regression: shared Agents created by another member used to default to
  // hidden, which left a new workspace member staring at an empty sidebar and
  // made the list impossible to curate collectively.
  it('shows every item by default, whoever created it', () => {
    expect(
      resolveSidebarItemVisibility({ id: 'own', type: 'agent', userId: 'member-1' }, options()),
    ).toBe(true);
    expect(
      resolveSidebarItemVisibility({ id: 'shared', type: 'agent', userId: 'member-2' }, options()),
    ).toBe(true);
    expect(
      resolveSidebarItemVisibility({ id: 'group', type: 'group', userId: 'member-2' }, options()),
    ).toBe(true);
  });

  it('hides items the caller opted out of, via override or the legacy hidden-id list', () => {
    expect(
      resolveSidebarItemVisibility(
        { id: 'shared', type: 'agent', userId: 'member-2' },
        options({ visibilityOverrides: { shared: false } }),
      ),
    ).toBe(false);
    expect(
      resolveSidebarItemVisibility(
        { id: 'legacy', type: 'agent', userId: 'member-1' },
        options({ hiddenItemIds: new Set(['legacy']) }),
      ),
    ).toBe(false);
  });

  it('lets an explicit override win over the legacy hidden-id list', () => {
    expect(
      resolveSidebarItemVisibility(
        { id: 'shared', type: 'agent', userId: 'member-2' },
        options({
          hiddenItemIds: new Set(['shared']),
          visibilityOverrides: { shared: true },
        }),
      ),
    ).toBe(true);
  });
});
