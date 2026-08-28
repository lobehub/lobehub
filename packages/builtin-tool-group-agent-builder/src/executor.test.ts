import type { BuiltinToolContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { groupAgentBuilderExecutor } from './executor';
import { GroupAgentBuilderApiName, GroupAgentBuilderIdentifier } from './types';

const { mockCreateAgent, mockRefreshGroupDetail, mockRefreshGroups, mockSetAgentBuilderContent } =
  vi.hoisted(() => ({
    mockCreateAgent: vi.fn(),
    mockRefreshGroupDetail: vi.fn(),
    mockRefreshGroups: vi.fn(),
    mockSetAgentBuilderContent: vi.fn(),
  }));

let activeGroupId: string | undefined = 'cg_1';

vi.mock('@/store/agentGroup', () => ({
  getChatGroupStoreState: () => ({
    activeGroupId,
    refreshGroupDetail: mockRefreshGroupDetail,
    refreshGroups: mockRefreshGroups,
  }),
}));

vi.mock('@/store/groupProfile', () => ({
  useGroupProfileStore: {
    getState: () => ({ setAgentBuilderContent: mockSetAgentBuilderContent }),
  },
}));

vi.mock('@/services/agent', () => ({ agentService: {} }));
vi.mock('@/services/discover', () => ({ discoverService: {} }));

vi.mock('@lobechat/agent-manager-runtime', () => ({ AgentManagerRuntime: vi.fn(() => ({})) }));

vi.mock('./ExecutionRuntime', () => ({
  GroupAgentBuilderExecutionRuntime: vi.fn(() => ({ createAgent: mockCreateAgent })),
}));

const afterCall = (apiName: string, params: unknown, success: boolean) =>
  groupAgentBuilderExecutor.onAfterCall({
    apiName,
    identifier: GroupAgentBuilderIdentifier,
    params,
    result: { content: '', success },
  });

describe('GroupAgentBuilderExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeGroupId = 'cg_1';
  });

  describe('group context resolution', () => {
    // The builder conversation is keyed by the builtin builder agent, so its
    // ConversationContext carries no groupId — falling back to the active group
    // is what keeps member creation working instead of erroring out.
    it('falls back to the active group when the tool context has no groupId', async () => {
      mockCreateAgent.mockResolvedValue({ content: 'ok', success: true });

      await groupAgentBuilderExecutor.createAgent(
        { systemRole: 'x', title: 'PM' },
        {} as BuiltinToolContext,
      );

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'cg_1',
        expect.objectContaining({ title: 'PM' }),
      );
    });

    it('reports a structured error when there is no group at all', async () => {
      activeGroupId = undefined;

      const result = await groupAgentBuilderExecutor.createAgent(
        { systemRole: 'x', title: 'PM' },
        {} as BuiltinToolContext,
      );

      expect(result).toMatchObject({ error: { type: 'NoGroupContext' }, success: false });
      expect(mockCreateAgent).not.toHaveBeenCalled();
    });
  });

  describe('onAfterCall', () => {
    // Under gateway mode the write commits server-side, so this hook is the only
    // thing that re-syncs the group Profile sidebar's member list.
    it('refreshes the group detail after a successful member write', async () => {
      await afterCall(GroupAgentBuilderApiName.batchCreateAgents, { agents: [] }, true);

      expect(mockRefreshGroupDetail).toHaveBeenCalledWith('cg_1');
    });

    it('does not refresh when the tool call failed', async () => {
      await afterCall(GroupAgentBuilderApiName.createAgent, { title: 'PM' }, false);

      expect(mockRefreshGroupDetail).not.toHaveBeenCalled();
    });

    it('does not refresh for read-only APIs', async () => {
      await afterCall(GroupAgentBuilderApiName.searchAgent, { query: 'pm' }, true);

      expect(mockRefreshGroupDetail).not.toHaveBeenCalled();
    });

    it('refreshes the group list after createGroup instead of a detail', async () => {
      await afterCall(GroupAgentBuilderApiName.createGroup, { title: 'Launch' }, true);

      expect(mockRefreshGroups).toHaveBeenCalled();
      expect(mockRefreshGroupDetail).not.toHaveBeenCalled();
    });

    it('syncs the open editor after a prompt write so autosave cannot revert it', async () => {
      await afterCall(
        GroupAgentBuilderApiName.updateAgentPrompt,
        { agentId: 'agt_1', prompt: 'new prompt' },
        true,
      );

      expect(mockSetAgentBuilderContent).toHaveBeenCalledWith('agt_1', 'new prompt');
    });

    it('syncs the group editor after a group prompt write', async () => {
      await afterCall(GroupAgentBuilderApiName.updateGroupPrompt, { prompt: 'shared' }, true);

      expect(mockSetAgentBuilderContent).toHaveBeenCalledWith('cg_1', 'shared');
    });
  });
});
