import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasServerRuntime } from '..';
import { groupAgentBuilderRuntime } from '../groupAgentBuilder';

const {
  mockAddAgentsToGroup,
  mockBatchCreate,
  mockBuilderUpdateConfig,
  mockFindById,
  mockGetAccessLevel,
  mockGetAgentConfigById,
  mockGetGroupAgentsWithMeta,
  mockRemoveAgentsFromGroup,
  mockSetAccessLevel,
  mockUpdateAgent,
  mockUpdateGroup,
} = vi.hoisted(() => ({
  mockAddAgentsToGroup: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockBuilderUpdateConfig: vi.fn(),
  mockFindById: vi.fn(),
  mockGetAccessLevel: vi.fn(),
  mockGetAgentConfigById: vi.fn(),
  mockGetGroupAgentsWithMeta: vi.fn(),
  mockRemoveAgentsFromGroup: vi.fn(),
  mockSetAccessLevel: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockUpdateGroup: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    batchCreate: mockBatchCreate,
    getAgentConfigById: mockGetAgentConfigById,
    queryAgents: vi.fn(async () => []),
    update: mockUpdateAgent,
    updateConfig: vi.fn(),
  })),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn(() => ({
    addAgentsToGroup: mockAddAgentsToGroup,
    findById: mockFindById,
    getGroupAgentsWithMeta: mockGetGroupAgentsWithMeta,
    removeAgentsFromGroup: mockRemoveAgentsFromGroup,
    update: mockUpdateGroup,
  })),
}));

vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: vi.fn(() => ({
    getAccessLevel: mockGetAccessLevel,
    setAccessLevel: mockSetAccessLevel,
  })),
}));

vi.mock('@/database/repositories/agentGroup', () => ({
  AgentGroupRepository: vi.fn(() => ({ createGroupWithSupervisor: vi.fn() })),
}));

vi.mock('@/server/services/agentGroup', () => ({
  AgentGroupService: vi.fn(() => ({ normalizeGroupConfig: (config: unknown) => config })),
}));

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(async () => undefined),
}));

vi.mock('../agentBuilder', () => ({
  agentBuilderRuntime: {
    factory: () => ({ updateConfig: mockBuilderUpdateConfig }),
    identifier: 'lobe-agent-builder',
  },
}));

const createRuntime = (workspaceId?: string) =>
  groupAgentBuilderRuntime.factory({
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
    workspaceId,
  });

const groupCtx = { editingGroupId: 'cg_1' } as never;

describe('groupAgentBuilderRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ id: 'cg_1', title: 'Launch Team', visibility: 'public' });
    mockGetGroupAgentsWithMeta.mockResolvedValue([
      { agentId: 'agt_sup', description: null, role: 'supervisor', title: 'Supervisor' },
    ]);
  });

  // The bug: gateway mode executes every builtin tool server-side, and a missing
  // registry entry makes `executeBuiltinTool` throw "is not implemented", so no
  // member ever reaches the group.
  it('is registered in the server runtime registry', () => {
    expect(hasServerRuntime('lobe-group-agent-builder')).toBe(true);
  });

  describe('createAgent', () => {
    it('creates a virtual agent and adds it to the edited group', async () => {
      mockBatchCreate.mockResolvedValue([{ id: 'agt_new', visibility: 'public' }]);

      const result = await createRuntime().createAgent(
        {
          systemRole: 'You drive launches.',
          title: 'Product Manager',
          tools: ['lobe-web-browsing'],
        },
        groupCtx,
      );

      expect(mockBatchCreate).toHaveBeenCalledWith([
        expect.objectContaining({
          plugins: ['lobe-web-browsing'],
          title: 'Product Manager',
          virtual: true,
          visibility: 'public',
        }),
      ]);
      expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_1', ['agt_new']);
      expect(result).toMatchObject({
        state: { agentId: 'agt_new', success: true, title: 'Product Manager' },
        success: true,
      });
    });

    it('inherits the group access level for workspace members', async () => {
      mockBatchCreate.mockResolvedValue([{ id: 'agt_new', visibility: 'public' }]);
      mockGetAccessLevel.mockResolvedValue('edit');

      await createRuntime('ws_1').createAgent({ systemRole: 'x', title: 'PM' }, groupCtx);

      expect(mockSetAccessLevel).toHaveBeenCalledWith('agent', 'agt_new', 'edit', 'user-1');
    });

    it('returns a structured error instead of throwing when no group is in context', async () => {
      const result = await createRuntime().createAgent(
        { systemRole: 'x', title: 'PM' },
        {} as never,
      );

      expect(result).toMatchObject({ error: { type: 'NoGroupContext' }, success: false });
      expect(mockBatchCreate).not.toHaveBeenCalled();
    });
  });

  describe('batchCreateAgents', () => {
    it('creates every agent and adds them all to the group in one roster write', async () => {
      mockBatchCreate.mockResolvedValue([
        { id: 'agt_a', visibility: 'public' },
        { id: 'agt_b', visibility: 'public' },
      ]);

      const result = await createRuntime().batchCreateAgents(
        {
          agents: [
            { systemRole: 'a', title: 'Marketing Lead' },
            { systemRole: 'b', title: 'Engineering Lead' },
          ],
        },
        groupCtx,
      );

      expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_1', ['agt_a', 'agt_b']);
      expect(result).toMatchObject({
        state: { failedCount: 0, successCount: 2 },
        success: true,
      });
    });
  });

  describe('removeAgent', () => {
    it('refuses to remove the supervisor', async () => {
      const result = await createRuntime().removeAgent({ agentId: 'agt_sup' }, groupCtx);

      expect(result.success).toBe(false);
      expect(mockRemoveAgentsFromGroup).not.toHaveBeenCalled();
    });

    it('removes a participant', async () => {
      mockGetGroupAgentsWithMeta.mockResolvedValue([
        { agentId: 'agt_sup', role: 'supervisor', title: 'Supervisor' },
        { agentId: 'agt_a', role: 'participant', title: 'Marketing Lead' },
      ]);

      const result = await createRuntime().removeAgent({ agentId: 'agt_a' }, groupCtx);

      expect(mockRemoveAgentsFromGroup).toHaveBeenCalledWith('cg_1', ['agt_a']);
      expect(result).toMatchObject({ state: { agentId: 'agt_a', success: true }, success: true });
    });
  });

  describe('updateAgentPrompt', () => {
    it('rejects an agent that is not a member of the group', async () => {
      const result = await createRuntime().updateAgentPrompt(
        { agentId: 'agt_outsider', prompt: 'hi' },
        groupCtx,
      );

      expect(result).toMatchObject({ error: { type: 'AgentNotFound' }, success: false });
      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });

    it('clears editorData so the profile editor does not revert the write', async () => {
      mockGetAgentConfigById.mockResolvedValue({ systemRole: 'old' });

      const result = await createRuntime().updateAgentPrompt(
        { agentId: 'agt_sup', prompt: 'new prompt' },
        groupCtx,
      );

      expect(mockUpdateAgent).toHaveBeenCalledWith('agt_sup', {
        editorData: null,
        systemRole: 'new prompt',
      });
      expect(result).toMatchObject({
        state: { newPrompt: 'new prompt', previousPrompt: 'old', success: true },
        success: true,
      });
    });
  });

  describe('updateConfig', () => {
    // The delegated `AgentBuilder.updateConfig` write is scoped by visibility
    // alone, so an unchecked caller-supplied id would let a group edit
    // reconfigure any workspace agent the caller can merely see.
    it('rejects a caller-supplied agent that is not on the roster', async () => {
      const result = await createRuntime('ws_1').updateConfig(
        { agentId: 'agt_outsider', model: 'gpt-5' },
        groupCtx,
      );

      expect(result).toMatchObject({ error: { type: 'AgentNotFound' }, success: false });
      expect(mockBuilderUpdateConfig).not.toHaveBeenCalled();
    });

    it('refuses a caller-supplied agent when there is no group in context', async () => {
      const result = await createRuntime('ws_1').updateConfig(
        { agentId: 'agt_sup', model: 'gpt-5' },
        {} as never,
      );

      expect(result).toMatchObject({ success: false });
      expect(mockBuilderUpdateConfig).not.toHaveBeenCalled();
    });

    it('delegates for a roster member, stamping it as the edited agent', async () => {
      await createRuntime('ws_1').updateConfig({ agentId: 'agt_sup', model: 'gpt-5' }, groupCtx);

      expect(mockBuilderUpdateConfig).toHaveBeenCalledWith(
        { model: 'gpt-5' },
        expect.objectContaining({ editingAgentId: 'agt_sup' }),
      );
    });

    it('falls back to the supervisor when no agentId is given', async () => {
      await createRuntime('ws_1').updateConfig({ model: 'gpt-5' }, groupCtx);

      expect(mockBuilderUpdateConfig).toHaveBeenCalledWith(
        { model: 'gpt-5' },
        expect.objectContaining({ editingAgentId: 'agt_sup' }),
      );
    });
  });

  describe('updateGroupPrompt', () => {
    it('writes the shared prompt onto the edited group', async () => {
      mockFindById.mockResolvedValue({ content: 'old', id: 'cg_1', visibility: 'public' });

      const result = await createRuntime().updateGroupPrompt(
        { prompt: 'shared context' },
        groupCtx,
      );

      expect(mockUpdateGroup).toHaveBeenCalledWith('cg_1', {
        content: 'shared context',
        editorData: null,
      });
      expect(result).toMatchObject({
        state: { newPrompt: 'shared context', previousPrompt: 'old', success: true },
        success: true,
      });
    });
  });
});
