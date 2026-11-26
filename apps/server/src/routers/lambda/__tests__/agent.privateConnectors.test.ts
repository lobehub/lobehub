// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { AgentService } from '@/server/services/agent';

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
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
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

const userId = 'creator-1';

/**
 * A private connector serves only its creator's private agents, and a shared
 * agent's runs leave it out: publishing an agent that still uses one would
 * drop its tool, or answer it with a same-identifier shared connector running
 * another account. Both publish paths refuse it.
 */
describe('publishing an agent that uses private connectors', () => {
  let agentModel: Record<string, ReturnType<typeof vi.fn>>;
  let countPrivateAgentBindings: ReturnType<typeof vi.fn>;
  const ctx = () => ({ agentModel, userId, workspaceId: 'ws-1' }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    agentModel = {
      getAgentVisibilityMeta: vi
        .fn()
        .mockResolvedValue({ pinned: false, slug: null, userId, visibility: 'private' }),
      publishToWorkspace: vi.fn().mockResolvedValue({ id: 'agent-1', visibility: 'public' }),
      setVisibility: vi.fn().mockResolvedValue({ id: 'agent-1' }),
      update: vi.fn(),
    };
    vi.mocked(AgentModel).mockImplementation(function () {
      return agentModel as never;
    });
    countPrivateAgentBindings = vi.fn().mockResolvedValue(1);
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return { countPrivateAgentBindings } as never;
    });
    vi.mocked(ResourcePermissionModel).mockImplementation(function () {
      return {
        getAccessLevel: vi.fn().mockResolvedValue(undefined),
        removeAll: vi.fn(),
        setAccessLevel: vi.fn(),
      } as never;
    });
    vi.mocked(AgentService).mockImplementation(function () {
      return {} as never;
    });
  });

  it('refuses publishAgentToWorkspace', async () => {
    await expect(
      agentRouter.createCaller(ctx()).publishAgentToWorkspace({ id: 'agent-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(countPrivateAgentBindings).toHaveBeenCalledWith('agent-1');
    expect(agentModel.publishToWorkspace).not.toHaveBeenCalled();
  });

  it('refuses setAgentVisibility to public', async () => {
    await expect(
      agentRouter.createCaller(ctx()).setAgentVisibility({ id: 'agent-1', visibility: 'public' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(agentModel.setVisibility).not.toHaveBeenCalled();
  });

  it('publishes once the agent uses no private connector', async () => {
    countPrivateAgentBindings.mockResolvedValue(0);

    await agentRouter.createCaller(ctx()).publishAgentToWorkspace({ id: 'agent-1' });

    expect(agentModel.publishToWorkspace).toHaveBeenCalledWith('agent-1');
  });
});
