// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import { AgentService } from '@/server/services/agent';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

import { agentRouter } from '../agent';

vi.mock('@/server/services/resourceEvents', () => ({ publishResourceEvent: vi.fn() }));
vi.mock('../_helpers/workspaceAgentGuard', () => ({
  getWorkspaceAgentParentGroupIds: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/database/models/user', () => ({ UserModel: { findById: vi.fn() } }));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/session', () => ({ SessionModel: vi.fn() }));
vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/database/models/chatGroup', () => ({ ChatGroupModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/models/resourcePermission', () => ({ ResourcePermissionModel: vi.fn() }));
vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: vi.fn(),
}));
vi.mock('@/server/services/agent', () => ({ AgentService: vi.fn() }));
vi.mock('@/server/services/workspacePermission', () => ({
  getWorkspaceScopedPermissionMatches: vi.fn(),
  hasWorkspaceScopedPermission: vi.fn(),
  isWorkspacePrimaryOwner: vi.fn(),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: vi.fn(),
  assertCanPerformResourceAction: vi.fn(),
  buildResourcePermissionState: vi.fn((params: unknown) => params),
  canPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
  isCollaborativeBuiltinAgent: vi.fn(() => false),
}));

const userId = 'member-1';
const matches = vi.mocked(getWorkspaceScopedPermissionMatches);

describe('agentRouter team pins', () => {
  let agentModel: Record<string, ReturnType<typeof vi.fn>>;
  let preference: {
    getPreference: ReturnType<typeof vi.fn>;
    updatePreference: ReturnType<typeof vi.fn>;
  };
  let ctx: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    agentModel = {
      getAgentVisibilityMeta: vi.fn(),
      publishToWorkspace: vi.fn().mockResolvedValue({ id: 'agent-1', visibility: 'public' }),
      update: vi.fn(),
    };
    vi.mocked(AgentModel).mockImplementation(function () {
      return agentModel as never;
    });
    preference = {
      getPreference: vi.fn().mockResolvedValue({ sidebarPinnedItemIds: ['older'] }),
      updatePreference: vi.fn(),
    };
    vi.mocked(WorkspaceUserSettingsModel).mockImplementation(function () {
      return preference as never;
    });
    vi.mocked(ResourcePermissionModel).mockImplementation(function () {
      return {
        getAccessLevel: vi.fn().mockResolvedValue(undefined),
        setAccessLevel: vi.fn(),
      } as never;
    });
    vi.mocked(AgentService).mockImplementation(function () {
      return {} as never;
    });
    ctx = { agentModel, userId, workspaceId: 'ws-1' };
  });

  describe('updateAgentPinned', () => {
    it('refuses a member pinning a public workspace agent (team pin)', async () => {
      agentModel.getAgentVisibilityMeta.mockResolvedValue({
        pinned: false,
        slug: null,
        userId: 'creator-1',
        visibility: 'public',
      });
      matches.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });

      await expect(
        agentRouter.createCaller(ctx as never).updateAgentPinned({ id: 'agent-1', pinned: true }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(agentModel.update).not.toHaveBeenCalled();
    });

    it('lets an owner/admin (agent:update:all) pin a public workspace agent', async () => {
      agentModel.getAgentVisibilityMeta.mockResolvedValue({
        pinned: false,
        slug: null,
        userId: 'creator-1',
        visibility: 'public',
      });
      matches.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });

      await agentRouter
        .createCaller(ctx as never)
        .updateAgentPinned({ id: 'agent-1', pinned: true });

      expect(matches).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AGENT_UPDATE', userId, workspaceId: 'ws-1' }),
      );
      expect(agentModel.update).toHaveBeenCalledWith('agent-1', { pinned: true });
    });

    it('keeps a private agent pin open to its creator without the team check', async () => {
      agentModel.getAgentVisibilityMeta.mockResolvedValue({
        pinned: false,
        slug: null,
        userId,
        visibility: 'private',
      });

      await agentRouter
        .createCaller(ctx as never)
        .updateAgentPinned({ id: 'agent-1', pinned: true });

      expect(matches).not.toHaveBeenCalled();
      expect(agentModel.update).toHaveBeenCalledWith('agent-1', { pinned: true });
    });

    it('leaves personal mode unchanged', async () => {
      await agentRouter
        .createCaller({ ...ctx, workspaceId: undefined } as never)
        .updateAgentPinned({ id: 'agent-1', pinned: true });

      expect(agentModel.getAgentVisibilityMeta).not.toHaveBeenCalled();
      expect(agentModel.update).toHaveBeenCalledWith('agent-1', { pinned: true });
    });
  });

  describe('publishAgentToWorkspace', () => {
    it('moves a private pin to the creator personal list instead of making it a team pin', async () => {
      agentModel.getAgentVisibilityMeta.mockResolvedValue({
        pinned: true,
        slug: null,
        userId,
        visibility: 'private',
      });

      await agentRouter.createCaller(ctx as never).publishAgentToWorkspace({ id: 'agent-1' });

      expect(preference.updatePreference).toHaveBeenCalledWith({
        sidebarPinnedItemIds: ['agent-1', 'older'],
      });
      expect(agentModel.update).toHaveBeenCalledWith('agent-1', { pinned: false });
      // Personal entry, then column, then publish: no step can leave a public
      // pinned row (an unauthorized team pin) behind.
      expect(preference.updatePreference.mock.invocationCallOrder[0]).toBeLessThan(
        agentModel.update.mock.invocationCallOrder[0],
      );
      expect(agentModel.update.mock.invocationCallOrder[0]).toBeLessThan(
        agentModel.publishToWorkspace.mock.invocationCallOrder[0],
      );
    });

    it('keeps the private pin when publishing fails', async () => {
      agentModel.getAgentVisibilityMeta.mockResolvedValue({
        pinned: true,
        slug: null,
        userId,
        visibility: 'private',
      });
      agentModel.publishToWorkspace.mockRejectedValue(new Error('publish failed'));

      await expect(
        agentRouter.createCaller(ctx as never).publishAgentToWorkspace({ id: 'agent-1' }),
      ).rejects.toThrow('publish failed');
      // The row stays private and the pin survives in the personal list.
      expect(preference.updatePreference).toHaveBeenCalledWith({
        sidebarPinnedItemIds: ['agent-1', 'older'],
      });
    });

    it('leaves an unpinned agent alone', async () => {
      agentModel.getAgentVisibilityMeta.mockResolvedValue({
        pinned: false,
        slug: null,
        userId,
        visibility: 'private',
      });

      await agentRouter.createCaller(ctx as never).publishAgentToWorkspace({ id: 'agent-1' });

      expect(preference.updatePreference).not.toHaveBeenCalled();
      expect(agentModel.update).not.toHaveBeenCalled();
    });
  });
});
