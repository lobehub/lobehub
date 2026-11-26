import { describe, expect, it, vi } from 'vitest';

import type { UserStore } from '@/store/user';

import { workspaceUserSettingsSelectors } from './selectors';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => 'ws-1',
}));

const store = (preference: object, source?: 'server' | 'storage') =>
  ({
    workspaceUserPreference: preference,
    workspaceUserPreferenceReplica: { entries: source ? { 'ws-1': { source } } : {} },
  }) as unknown as UserStore;

const { sidebarSetupPreview } = workspaceUserSettingsSelectors;

describe('sidebarSetupPreview', () => {
  it('previews the team pins for cached choices from an earlier visit', () => {
    expect(sidebarSetupPreview(store({ sidebarPinnedItemIds: ['a'] }, 'storage'))).toBe('teamPins');
  });

  it('previews the recommended Agents for a member with nothing saved yet', () => {
    expect(sidebarSetupPreview(store({}))).toBe('recommended');
  });

  it('previews nothing once the sidebar is set up', () => {
    expect(sidebarSetupPreview(store({ sidebarInitialized: true }, 'storage'))).toBeNull();
  });

  it('previews nothing once the server answered without setting the sidebar up', () => {
    // The server sets the sidebar up in that same answer whenever it can, so
    // a guess from the preference's shape would only contradict it.
    expect(sidebarSetupPreview(store({}, 'server'))).toBeNull();
    expect(sidebarSetupPreview(store({ sidebarHiddenGroupIds: ['g'] }, 'server'))).toBeNull();
  });
});
