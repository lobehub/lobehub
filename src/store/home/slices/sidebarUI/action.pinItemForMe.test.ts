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
const refreshPreference = vi.fn();

beforeEach(() => {
  updatePreference.mockReset().mockResolvedValue(undefined);
  refreshPreference.mockReset().mockResolvedValue(undefined);
  vi.spyOn(agentService, 'updateAgentPinned').mockResolvedValue(undefined as any);
  vi.spyOn(chatGroupService, 'updateGroup').mockResolvedValue(undefined as any);
  vi.spyOn(useHomeStore.getState(), 'refreshAgentList').mockResolvedValue(undefined);
  useHomeStore.setState({ pinnedAgents: [] } as any);
  useUserStore.setState({
    refreshWorkspaceUserPreference: refreshPreference,
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
    // The shared column is the default pin for new members — a member's pin must not touch it.
    expect(agentService.updateAgentPinned).not.toHaveBeenCalled();
  });

  it('unpins a public agent from the member preference only, keeping it listed', async () => {
    useUserStore.setState({ workspaceUserPreference: { sidebarPinnedItemIds: ['pub', 'older'] } });

    await pinForMe({ id: 'pub', pinned: true, type: 'agent', visibility: 'public' }, false);

    // A default pin seeded into the member's list moves down instead of
    // leaving the sidebar, and the default itself is left alone.
    expect(updatePreference).toHaveBeenCalledWith({
      sidebarAgentVisibilityOverrides: { pub: true },
      sidebarPinnedItemIds: ['older'],
    });
    expect(agentService.updateAgentPinned).not.toHaveBeenCalled();
  });

  it('waits for the server to set the sidebar up before a first pin', async () => {
    useHomeStore.setState({ pinnedAgents: [{ id: 'team-1' }] } as any);
    // The server answers with the team pins copied in after the member's own.
    refreshPreference.mockImplementation(async () => {
      useUserStore.setState({
        workspaceUserPreference: {
          sidebarInitialized: true,
          sidebarPinnedItemIds: ['older', 'team-1'],
        },
      });
    });

    await pinForMe({ id: 'pub', pinned: false, type: 'agent', visibility: 'public' }, true);

    expect(refreshPreference).toHaveBeenCalledTimes(1);
    // Built on the server's answer; the client never sets the sidebar up itself.
    expect(updatePreference).toHaveBeenCalledWith({
      sidebarPinnedItemIds: ['pub', 'older', 'team-1'],
    });
  });

  it('does not wait once the sidebar is set up', async () => {
    useUserStore.setState({
      workspaceUserPreference: { sidebarInitialized: true, sidebarPinnedItemIds: ['older'] },
    });

    await pinForMe({ id: 'pub', pinned: false, type: 'agent', visibility: 'public' }, true);

    expect(refreshPreference).not.toHaveBeenCalled();
    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: ['pub', 'older'] });
  });

  it('keeps an explicit sidebar choice when unpinning', async () => {
    useUserStore.setState({
      workspaceUserPreference: {
        sidebarAgentVisibilityOverrides: { pub: false },
        sidebarPinnedItemIds: ['pub'],
      },
    });

    await pinForMe({ id: 'pub', pinned: false, type: 'agent', visibility: 'public' }, false);

    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: [] });
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
