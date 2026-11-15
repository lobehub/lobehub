import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { chatGroupService } from '@/services/chatGroup';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: vi.fn(() => 'ws-1'),
  useActiveWorkspaceId: vi.fn(() => 'ws-1'),
}));

const updatePreference = vi.fn();

beforeEach(() => {
  updatePreference.mockReset().mockResolvedValue(undefined);
  vi.spyOn(agentService, 'updateAgentPinned').mockResolvedValue(undefined as any);
  vi.spyOn(chatGroupService, 'updateGroup').mockResolvedValue(undefined as any);
  vi.spyOn(useHomeStore.getState(), 'refreshAgentList').mockResolvedValue(undefined);
  useUserStore.setState({
    updateWorkspaceUserPreference: updatePreference,
    workspaceUserPreference: { sidebarPinnedItemIds: ['older'] },
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const pinForMe = (...args: Parameters<ReturnType<typeof useHomeStore.getState>['pinItemForMe']>) =>
  act(() => useHomeStore.getState().pinItemForMe(...args));

describe('pinItemForMe', () => {
  it('pins a public agent in the member preference only, newest first', async () => {
    await pinForMe({ id: 'pub', pinned: false, type: 'agent', visibility: 'public' }, true);

    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: ['pub', 'older'] });
    // The shared column is the team pin — a member's pin must not touch it.
    expect(agentService.updateAgentPinned).not.toHaveBeenCalled();
  });

  it('unpins a public agent from the member preference only', async () => {
    useUserStore.setState({ workspaceUserPreference: { sidebarPinnedItemIds: ['pub', 'older'] } });

    await pinForMe({ id: 'pub', pinned: true, type: 'agent', visibility: 'public' }, false);

    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: ['older'] });
    // Even when the row is team-pinned, a personal unpin leaves the team pin.
    expect(agentService.updateAgentPinned).not.toHaveBeenCalled();
  });

  it('keeps a private agent column in sync with its preference entry', async () => {
    await pinForMe({ id: 'priv', pinned: false, type: 'agent', visibility: 'private' }, true);

    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: ['priv', 'older'] });
    expect(agentService.updateAgentPinned).toHaveBeenCalledWith('priv', true);
  });

  it('clears a legacy private pin that exists only on the column', async () => {
    await pinForMe({ id: 'legacy', pinned: true, type: 'agent', visibility: 'private' }, false);

    // Not in the preference: nothing to write there.
    expect(updatePreference).not.toHaveBeenCalled();
    expect(agentService.updateAgentPinned).toHaveBeenCalledWith('legacy', false);
  });

  it('routes a private chat group through the group column', async () => {
    await pinForMe({ id: 'grp', pinned: false, type: 'group', visibility: 'private' }, true);

    expect(chatGroupService.updateGroup).toHaveBeenCalledWith('grp', { pinned: true });
    expect(agentService.updateAgentPinned).not.toHaveBeenCalled();
  });
});
