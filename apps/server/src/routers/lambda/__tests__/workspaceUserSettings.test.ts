// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const mockUpdatePreference = vi.fn();
const mockSetWorktreeModeDir = vi.fn();
const mockGetPreference = vi.fn();
const mockInitializeSidebar = vi.fn();
const mockGetJoinedAt = vi.fn();
vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: vi.fn(function () {
    return {
      getJoinedAt: mockGetJoinedAt,
      getPreference: mockGetPreference,
      initializeSidebar: mockInitializeSidebar,
      setWorktreeModeDir: mockSetWorktreeModeDir,
      updatePreference: mockUpdatePreference,
    };
  }),
}));

const mockGetTeamPinnedIds = vi.fn();
const mockGetRecommendedIds = vi.fn();
vi.mock('@/database/repositories/home', () => ({
  HomeRepository: vi.fn(function () {
    return { getRecommendedIds: mockGetRecommendedIds, getTeamPinnedIds: mockGetTeamPinnedIds };
  }),
}));

const mockUpdateSessionGroupId = vi.fn();
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return {
      updateSessionGroupId: mockUpdateSessionGroupId,
    };
  }),
}));

const mockHasPermission = vi.fn();
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: (...args: any[]) => mockHasPermission(...args),
}));

const mockChatGroupUpdate = vi.fn();
vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn(function () {
    return {
      update: mockChatGroupUpdate,
    };
  }),
}));

const mockAssertCanEdit = vi.fn();
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: (...args: any[]) => mockAssertCanEdit(...args),
}));

const mockGetBlockingHolder = vi.fn();
vi.mock('@/server/services/editLock', () => ({
  EditLockService: vi.fn(function () {
    return {
      getBlockingHolder: mockGetBlockingHolder,
    };
  }),
}));

const { workspaceUserSettingsRouter } = await import('../workspaceUserSettings');

describe('workspaceUserSettingsRouter.updatePreference', () => {
  const ctx: any = { serverDB: {}, userId: 'user-member', workspaceId: 'ws-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockResolvedValue(true);
    mockUpdatePreference.mockResolvedValue({ preference: {} });
    mockUpdateSessionGroupId.mockResolvedValue({ id: 'agt_1' });
    mockAssertCanEdit.mockResolvedValue(undefined);
    mockGetBlockingHolder.mockResolvedValue(null);
    mockChatGroupUpdate.mockResolvedValue({ id: 'cg_1' });
  });

  describe('legacy sidebarGroupAssignments compat for "Move to Category"', () => {
    it('translates a pre-shared-sidebar move into the shared sessionGroupId write', async () => {
      // A client from before the shared-sidebar change still sends its
      // "Move to Category" through this per-member map, which the sidebar no
      // longer reads — without translation the move silently does nothing.
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      await caller.updatePreference({ sidebarGroupAssignments: { agt_1: 'sg_target' } });

      expect(mockUpdateSessionGroupId).toHaveBeenCalledWith('agt_1', 'sg_target');
      // The preference itself still persists unchanged (rollback safety).
      expect(mockUpdatePreference).toHaveBeenCalledWith({
        sidebarGroupAssignments: { agt_1: 'sg_target' },
      });
    });

    it('maps a "default list" (null) assignment to a null sessionGroupId', async () => {
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      await caller.updatePreference({ sidebarGroupAssignments: { agt_1: null } });

      expect(mockUpdateSessionGroupId).toHaveBeenCalledWith('agt_1', null);
    });

    it('skips translation when the caller lacks the agent:update scope', async () => {
      mockHasPermission.mockResolvedValue(false);
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      await caller.updatePreference({ sidebarGroupAssignments: { agt_1: 'sg_target' } });

      expect(mockUpdateSessionGroupId).not.toHaveBeenCalled();
      expect(mockUpdatePreference).toHaveBeenCalled();
    });

    it('keeps the preference write alive when one assignment fails', async () => {
      mockUpdateSessionGroupId
        .mockRejectedValueOnce(new Error('Session group sg_gone not found in current scope'))
        .mockResolvedValueOnce({ id: 'agt_2' });
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      const result = await caller.updatePreference({
        sidebarGroupAssignments: { agt_1: 'sg_gone', agt_2: 'sg_target' },
      });

      expect(result.success).toBe(true);
      expect(mockUpdateSessionGroupId).toHaveBeenCalledTimes(2);
      expect(mockUpdatePreference).toHaveBeenCalled();
    });

    it('routes chat-group ids through ChatGroupModel.update, not AgentModel', async () => {
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      await caller.updatePreference({ sidebarGroupAssignments: { cg_1: 'sg_target' } });

      expect(mockChatGroupUpdate).toHaveBeenCalledWith('cg_1', { groupId: 'sg_target' });
      expect(mockUpdateSessionGroupId).not.toHaveBeenCalled();
      // Per-resource edit access is enforced like agentGroup.updateGroup.
      expect(mockAssertCanEdit).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'cg_1', resourceType: 'agentGroup' }),
      );
    });

    it('maps a "default list" (null) chat-group assignment to a null groupId', async () => {
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      await caller.updatePreference({ sidebarGroupAssignments: { cg_1: null } });

      expect(mockChatGroupUpdate).toHaveBeenCalledWith('cg_1', { groupId: null });
    });

    it('skips the chat-group move when resource edit access is denied', async () => {
      mockAssertCanEdit.mockRejectedValue(new Error('FORBIDDEN'));
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      const result = await caller.updatePreference({
        sidebarGroupAssignments: { cg_1: 'sg_target' },
      });

      expect(mockChatGroupUpdate).not.toHaveBeenCalled();
      // Best-effort: the preference write itself still succeeds.
      expect(result.success).toBe(true);
      expect(mockUpdatePreference).toHaveBeenCalled();
    });

    it('skips the chat-group move while another member holds the edit lock', async () => {
      mockGetBlockingHolder.mockResolvedValue({ userId: 'user-other' });
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      const result = await caller.updatePreference({
        sidebarGroupAssignments: { cg_1: 'sg_target' },
      });

      expect(mockGetBlockingHolder).toHaveBeenCalledWith('chatGroup', 'cg_1');
      expect(mockChatGroupUpdate).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('does not run the permission check for patches without legacy fields', async () => {
      const caller = workspaceUserSettingsRouter.createCaller(ctx);

      await caller.updatePreference({ agentDeviceOverrides: { agt_1: 'device-1' } });

      expect(mockHasPermission).not.toHaveBeenCalled();
      expect(mockUpdateSessionGroupId).not.toHaveBeenCalled();
      expect(mockUpdatePreference).toHaveBeenCalledWith({
        agentDeviceOverrides: { agt_1: 'device-1' },
      });
    });
  });
});

describe('workspaceUserSettingsRouter.setWorktreeModeDir', () => {
  const ctx: any = { serverDB: {}, userId: 'user-member', workspaceId: 'ws-1' };

  it('stores one directory switch through the model and returns the list', async () => {
    mockSetWorktreeModeDir.mockResolvedValue(['dev::/code/a']);
    const caller = workspaceUserSettingsRouter.createCaller(ctx);

    await expect(
      caller.setWorktreeModeDir({ enabled: true, key: 'dev::/code/a' }),
    ).resolves.toEqual(['dev::/code/a']);
    expect(mockSetWorktreeModeDir).toHaveBeenCalledWith('dev::/code/a', true);
  });

  it('rejects an empty key', async () => {
    const caller = workspaceUserSettingsRouter.createCaller(ctx);
    await expect(caller.setWorktreeModeDir({ enabled: true, key: '' })).rejects.toThrow();
  });
});

describe('workspaceUserSettingsRouter.getPreference', () => {
  const ctx: any = { serverDB: {}, userId: 'user-member', workspaceId: 'ws-1' };
  const joinedBefore = new Date('2026-01-01T00:00:00Z');
  const joinedAfter = new Date('2026-12-01T00:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the team pins as the own pins of a member who joined while they were shown', async () => {
    mockGetPreference.mockResolvedValue({ sidebarPinnedItemIds: ['mine'] });
    mockGetJoinedAt.mockResolvedValue(joinedBefore);
    mockGetTeamPinnedIds.mockResolvedValue(['team-1', 'team-2']);
    const seeded = {
      sidebarInitialized: true,
      sidebarPinnedItemIds: ['mine', 'team-1', 'team-2'],
    };
    mockInitializeSidebar.mockResolvedValue(seeded);

    const result = await workspaceUserSettingsRouter.createCaller(ctx).getPreference();

    expect(mockInitializeSidebar).toHaveBeenCalledWith({
      final: true,
      pinIds: ['team-1', 'team-2'],
    });
    expect(mockGetRecommendedIds).not.toHaveBeenCalled();
    expect(result).toEqual(seeded);
  });

  it('lists the recommended Agents, unpinned, for a member who joined later', async () => {
    mockGetPreference.mockResolvedValue({});
    mockGetJoinedAt.mockResolvedValue(joinedAfter);
    mockGetRecommendedIds.mockResolvedValue(['rec-1']);
    const seeded = { sidebarAgentVisibilityOverrides: { 'rec-1': true }, sidebarInitialized: true };
    mockInitializeSidebar.mockResolvedValue(seeded);

    const result = await workspaceUserSettingsRouter.createCaller(ctx).getPreference();

    expect(mockInitializeSidebar).toHaveBeenCalledWith({ listIds: ['rec-1'] });
    expect(mockGetTeamPinnedIds).not.toHaveBeenCalled();
    expect(result).toEqual(seeded);
  });

  it('never sets the sidebar up again once it was', async () => {
    const preference = { sidebarInitialized: true, sidebarPinnedItemIds: ['mine'] };
    mockGetPreference.mockResolvedValue(preference);

    const result = await workspaceUserSettingsRouter.createCaller(ctx).getPreference();

    expect(result).toEqual(preference);
    expect(mockGetJoinedAt).not.toHaveBeenCalled();
    expect(mockInitializeSidebar).not.toHaveBeenCalled();
  });

  it('leaves a caller who is not a member alone', async () => {
    mockGetPreference.mockResolvedValue({});
    mockGetJoinedAt.mockResolvedValue(undefined);

    const result = await workspaceUserSettingsRouter.createCaller(ctx).getPreference();

    expect(result).toEqual({});
    expect(mockInitializeSidebar).not.toHaveBeenCalled();
  });

  it('still returns the preference when the setup fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetPreference.mockResolvedValue({ sidebarPinnedItemIds: ['mine'] });
    mockGetJoinedAt.mockRejectedValue(new Error('db down'));

    const result = await workspaceUserSettingsRouter.createCaller(ctx).getPreference();

    expect(result).toEqual({ sidebarPinnedItemIds: ['mine'] });
    spy.mockRestore();
  });
});
