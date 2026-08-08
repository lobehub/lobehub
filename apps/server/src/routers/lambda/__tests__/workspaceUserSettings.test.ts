// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const mockUpdatePreference = vi.fn();
vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: vi.fn(() => ({
    updatePreference: mockUpdatePreference,
  })),
}));

const mockUpdateSessionGroupId = vi.fn();
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    updateSessionGroupId: mockUpdateSessionGroupId,
  })),
}));

const mockHasPermission = vi.fn();
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: (...args: any[]) => mockHasPermission(...args),
}));

const mockChatGroupUpdate = vi.fn();
vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn(() => ({
    update: mockChatGroupUpdate,
  })),
}));

const mockAssertCanEdit = vi.fn();
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: (...args: any[]) => mockAssertCanEdit(...args),
}));

const mockGetBlockingHolder = vi.fn();
vi.mock('@/server/services/editLock', () => ({
  EditLockService: vi.fn(() => ({
    getBlockingHolder: mockGetBlockingHolder,
  })),
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

  describe('legacy sidebarGroupAssignments compat (LOBE-12860)', () => {
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
