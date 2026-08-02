import { describe, expect, it } from 'vitest';

import { resolveSidebarItemVisibility } from './useSidebarItemVisibility';

const options = (overrides: Partial<Parameters<typeof resolveSidebarItemVisibility>[1]> = {}) => ({
  currentUserId: 'member-1',
  hiddenItemIds: new Set<string>(),
  isWorkspaceMode: true,
  visibilityOverrides: {},
  ...overrides,
});

describe('resolveSidebarItemVisibility', () => {
  it('shows own Agents and hides Agents created by another workspace member by default', () => {
    expect(
      resolveSidebarItemVisibility({ id: 'own', type: 'agent', userId: 'member-1' }, options()),
    ).toBe(true);
    expect(
      resolveSidebarItemVisibility({ id: 'shared', type: 'agent', userId: 'member-2' }, options()),
    ).toBe(false);
  });

  it('keeps builtin Agents and chat groups visible by default', () => {
    expect(
      resolveSidebarItemVisibility(
        { id: 'builtin', slug: 'agent-builder', type: 'agent', userId: 'member-2' },
        options(),
      ),
    ).toBe(true);
    expect(
      resolveSidebarItemVisibility({ id: 'group', type: 'group', userId: 'member-2' }, options()),
    ).toBe(true);
  });

  it('lets an explicit per-member override win over ownership and legacy hidden ids', () => {
    expect(
      resolveSidebarItemVisibility(
        { id: 'shared', type: 'agent', userId: 'member-2' },
        options({
          hiddenItemIds: new Set(['shared']),
          visibilityOverrides: { shared: true },
        }),
      ),
    ).toBe(true);
    expect(
      resolveSidebarItemVisibility(
        { id: 'own', type: 'agent', userId: 'member-1' },
        options({ visibilityOverrides: { own: false } }),
      ),
    ).toBe(false);
  });

  it('preserves personal-mode visibility and the legacy hidden-id preference', () => {
    expect(
      resolveSidebarItemVisibility(
        { id: 'personal', type: 'agent', userId: 'member-2' },
        options({ isWorkspaceMode: false }),
      ),
    ).toBe(true);
    expect(
      resolveSidebarItemVisibility(
        { id: 'personal', type: 'agent', userId: 'member-1' },
        options({ hiddenItemIds: new Set(['personal']), isWorkspaceMode: false }),
      ),
    ).toBe(false);
  });
});
