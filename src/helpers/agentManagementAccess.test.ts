import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAgentManagementAccessCache,
  ensureAgentManagementAccess,
  getRuntimeCanManageAgent,
  rememberAgentManagementAccess,
} from './agentManagementAccess';

const getGeneralAccess = vi.hoisted(() => vi.fn());

vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: { getGeneralAccess },
}));

describe('agentManagementAccess', () => {
  beforeEach(() => {
    clearAgentManagementAccessCache();
    getGeneralAccess.mockReset();
  });

  it('treats the author as managing without any resolved answer', () => {
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u1' }),
    ).toBe(true);
  });

  it('falls back to non-manager for an unresolved non-author', () => {
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
    ).toBe(false);
  });

  it('promotes a non-author once the server confirmed management access', () => {
    rememberAgentManagementAccess('u2', 'a1', true);
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
    ).toBe(true);
  });

  it('keeps a resolved non-manager answer non-managing', () => {
    rememberAgentManagementAccess('u2', 'a1', false);
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
    ).toBe(false);
  });

  it('never lets one user inherit another user’s resolved answer', () => {
    rememberAgentManagementAccess('u2', 'a1', true);
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u3' }),
    ).toBe(false);
  });

  it('ignores the cache entirely when the caller is unauthenticated', () => {
    rememberAgentManagementAccess('u2', 'a1', true);
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: undefined }),
    ).toBe(false);
  });

  describe('ensureAgentManagementAccess', () => {
    const publicWorkspaceAgent = {
      agentId: 'a1',
      agentUserId: 'u1',
      currentUserId: 'u2',
      visibility: 'public' as const,
      workspaceId: 'ws-1',
    };

    it('resolves an unprimed non-author from the server before dispatch', async () => {
      getGeneralAccess.mockResolvedValue({ canManage: true });

      await ensureAgentManagementAccess(publicWorkspaceAgent);

      expect(getGeneralAccess).toHaveBeenCalledWith('agent', 'a1');
      expect(
        getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
      ).toBe(true);
    });

    it('skips the request for authors, private agents, and cached entries', async () => {
      await ensureAgentManagementAccess({ ...publicWorkspaceAgent, currentUserId: 'u1' });
      await ensureAgentManagementAccess({ ...publicWorkspaceAgent, visibility: 'private' });
      await ensureAgentManagementAccess({ ...publicWorkspaceAgent, workspaceId: undefined });
      rememberAgentManagementAccess('u2', 'a1', false);
      await ensureAgentManagementAccess(publicWorkspaceAgent);

      expect(getGeneralAccess).not.toHaveBeenCalled();
    });

    it('shares one in-flight request between concurrent dispatches', async () => {
      let release!: (value: { canManage: boolean }) => void;
      getGeneralAccess.mockReturnValue(new Promise((resolve) => (release = resolve)));

      const first = ensureAgentManagementAccess(publicWorkspaceAgent);
      const second = ensureAgentManagementAccess(publicWorkspaceAgent);
      release({ canManage: true });
      await Promise.all([first, second]);

      expect(getGeneralAccess).toHaveBeenCalledTimes(1);
      expect(
        getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
      ).toBe(true);
    });

    it('falls back to authorship and leaves the entry uncached when the fetch fails', async () => {
      getGeneralAccess.mockRejectedValue(new Error('offline'));

      await ensureAgentManagementAccess(publicWorkspaceAgent);

      expect(
        getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
      ).toBe(false);

      // The next dispatch retries instead of trusting the failure.
      getGeneralAccess.mockResolvedValue({ canManage: true });
      await ensureAgentManagementAccess(publicWorkspaceAgent);
      expect(
        getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
      ).toBe(true);
    });
  });
});
