import type { BuiltinToolContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { groupAgentBuilderExecutor } from './executor';
import { GroupAgentBuilderApiName, GroupAgentBuilderIdentifier } from './types';

const {
  mockCreateAgent,
  mockGetGroupDetail,
  mockInstallPlugin,
  mockRefreshGroupDetail,
  mockRefreshGroups,
  mockSetAgentBuilderContent,
  mockUpdateAgentConfig,
  mockUpdateGroup,
  mockUpdateGroupPrompt,
} = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
  mockGetGroupDetail: vi.fn(),
  mockInstallPlugin: vi.fn(),
  mockRefreshGroupDetail: vi.fn(),
  mockRefreshGroups: vi.fn(),
  mockSetAgentBuilderContent: vi.fn(),
  mockUpdateAgentConfig: vi.fn(),
  mockUpdateGroup: vi.fn(),
  mockUpdateGroupPrompt: vi.fn(),
}));

let activeGroupId: string | undefined = 'cg_1';
let groupMap: Record<string, unknown> = {};

vi.mock('@/store/agentGroup', () => ({
  getChatGroupStoreState: () => ({
    activeGroupId,
    groupMap,
    refreshGroupDetail: mockRefreshGroupDetail,
    refreshGroups: mockRefreshGroups,
  }),
}));

let dbMessagesMap: Record<string, unknown[]> = {};

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ dbMessagesMap }) },
}));

/** A builder conversation whose earlier `createGroup` produced `cg_new`. */
const conversationWithCreatedGroup = () => ({
  'builder-topic': [
    { id: 'msg_user', role: 'user' },
    {
      id: 'msg_create_group',
      plugin: { apiName: 'createGroup', identifier: GroupAgentBuilderIdentifier },
      pluginState: { groupId: 'cg_new', success: true },
      role: 'tool',
      tool_call_id: 'call_create_group',
    },
    { id: 'msg_create_agent', role: 'tool', tool_call_id: 'call_create_agent' },
  ],
});

vi.mock('@/store/groupProfile', () => ({
  useGroupProfileStore: {
    getState: () => ({ setAgentBuilderContent: mockSetAgentBuilderContent }),
  },
}));

vi.mock('@/services/agent', () => ({ agentService: {} }));
vi.mock('@/services/discover', () => ({ discoverService: {} }));
vi.mock('@/services/chatGroup', () => ({
  chatGroupService: { getGroupDetail: mockGetGroupDetail },
}));

vi.mock('@lobechat/agent-manager-runtime', () => ({
  AgentManagerRuntime: vi.fn(function () {
    return { installPlugin: mockInstallPlugin, updateAgentConfig: mockUpdateAgentConfig };
  }),
}));

vi.mock('./ExecutionRuntime', () => ({
  GroupAgentBuilderExecutionRuntime: vi.fn(function () {
    return {
      createAgent: mockCreateAgent,
      updateGroup: mockUpdateGroup,
      updateGroupPrompt: mockUpdateGroupPrompt,
    };
  }),
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
    groupMap = {};
    dbMessagesMap = {};
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

    // Client-runtime counterpart of the server fix: createGroup does not make
    // the new group active, so without reading it back from the conversation a
    // member tool without groupId lands in the old (shell) group.
    it('follows the group createGroup made earlier in this conversation', async () => {
      dbMessagesMap = conversationWithCreatedGroup();
      mockCreateAgent.mockResolvedValue({ content: 'ok', success: true });

      await groupAgentBuilderExecutor.createAgent({ systemRole: 'x', title: 'PM' }, {
        messageId: 'msg_create_agent',
      } as BuiltinToolContext);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'cg_new',
        expect.objectContaining({ title: 'PM' }),
      );
    });

    it('an explicit groupId wins over the created group', async () => {
      dbMessagesMap = conversationWithCreatedGroup();
      mockCreateAgent.mockResolvedValue({ content: 'ok', success: true });

      await groupAgentBuilderExecutor.createAgent(
        { groupId: 'cg_named', systemRole: 'x', title: 'PM' },
        {
          messageId: 'msg_create_agent',
        } as BuiltinToolContext,
      );

      expect(mockCreateAgent).toHaveBeenCalledWith('cg_named', expect.anything());
    });

    // Group-level writes resolve their target inside the execution runtime,
    // which only knows the profile page's active group — the created group has
    // to be handed to it, or `createGroup` → `updateGroupPrompt` edits the shell.
    it('group-level writes follow the group createGroup made in this conversation', async () => {
      dbMessagesMap = conversationWithCreatedGroup();
      const ctx = { messageId: 'msg_create_agent' } as BuiltinToolContext;

      await groupAgentBuilderExecutor.updateGroupPrompt({ prompt: 'shared' }, ctx);
      await groupAgentBuilderExecutor.updateGroup({ meta: { title: 'Dev Team' } }, ctx);

      expect(mockUpdateGroupPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'cg_new', prompt: 'shared' }),
      );
      expect(mockUpdateGroup).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'cg_new', meta: { title: 'Dev Team' } }),
      );
    });

    it('group-level writes keep an explicit groupId and otherwise defer to the runtime', async () => {
      dbMessagesMap = conversationWithCreatedGroup();

      await groupAgentBuilderExecutor.updateGroupPrompt({ groupId: 'cg_named', prompt: 'p' }, {
        messageId: 'msg_create_agent',
      } as BuiltinToolContext);
      // No group created in this conversation: leave the target to the runtime's
      // own active-group resolution.
      await groupAgentBuilderExecutor.updateGroup(
        { meta: { title: 'T' } },
        {} as BuiltinToolContext,
      );

      expect(mockUpdateGroupPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'cg_named' }),
      );
      expect(mockUpdateGroup.mock.calls[0][0].groupId).toBeUndefined();
    });

    // One assistant message issues createGroup + updateGroupPrompt + createAgent.
    // createGroup needs approval, so the runtime runs the other two first — at
    // that point no group has been created yet and they would silently edit the
    // pinned/active group. They must not run until createGroup has returned.
    describe('mixed batch with createGroup still awaiting approval', () => {
      const mixedBatch = (createGroupState?: Record<string, unknown>) => ({
        'builder-topic': [
          { id: 'msg_user', role: 'user' },
          {
            id: 'msg_assistant',
            role: 'assistant',
            tools: [
              {
                apiName: 'createGroup',
                id: 'call_create_group',
                identifier: GroupAgentBuilderIdentifier,
              },
              {
                apiName: 'updateGroupPrompt',
                id: 'call_prompt',
                identifier: GroupAgentBuilderIdentifier,
              },
              { apiName: 'createAgent', id: 'call_agent', identifier: GroupAgentBuilderIdentifier },
            ],
          },
          {
            id: 'msg_create_group',
            parentId: 'msg_assistant',
            plugin: { apiName: 'createGroup', identifier: GroupAgentBuilderIdentifier },
            pluginState: createGroupState,
            role: 'tool',
            tool_call_id: 'call_create_group',
          },
          {
            id: 'msg_prompt',
            parentId: 'msg_assistant',
            role: 'tool',
            tool_call_id: 'call_prompt',
          },
          { id: 'msg_agent', parentId: 'msg_assistant', role: 'tool', tool_call_id: 'call_agent' },
        ],
      });

      it('refuses sibling writes instead of editing the active group', async () => {
        dbMessagesMap = mixedBatch();

        const prompt = await groupAgentBuilderExecutor.updateGroupPrompt({ prompt: 'shared' }, {
          anchorMessageId: 'msg_assistant',
          messageId: 'msg_prompt',
          toolCallId: 'call_prompt',
        } as BuiltinToolContext);
        const agent = await groupAgentBuilderExecutor.createAgent(
          { systemRole: 'x', title: 'PM' },
          {
            anchorMessageId: 'msg_assistant',
            messageId: 'msg_agent',
            toolCallId: 'call_agent',
          } as BuiltinToolContext,
        );

        for (const result of [prompt, agent]) {
          expect(result).toMatchObject({
            error: { type: 'AwaitingCreateGroup' },
            success: false,
          });
        }
        expect(mockUpdateGroupPrompt).not.toHaveBeenCalled();
        expect(mockCreateAgent).not.toHaveBeenCalled();
      });

      it('lets the siblings through once createGroup has returned its group', async () => {
        dbMessagesMap = mixedBatch({ groupId: 'cg_new', success: true });
        mockCreateAgent.mockResolvedValue({ content: 'ok', success: true });

        await groupAgentBuilderExecutor.createAgent({ systemRole: 'x', title: 'PM' }, {
          anchorMessageId: 'msg_assistant',
          messageId: 'msg_agent',
          toolCallId: 'call_agent',
        } as BuiltinToolContext);

        expect(mockCreateAgent).toHaveBeenCalledWith('cg_new', expect.anything());
      });

      it('an explicit groupId is not held back', async () => {
        dbMessagesMap = mixedBatch();
        mockCreateAgent.mockResolvedValue({ content: 'ok', success: true });

        await groupAgentBuilderExecutor.createAgent(
          { groupId: 'cg_named', systemRole: 'x', title: 'PM' },
          {
            anchorMessageId: 'msg_assistant',
            messageId: 'msg_agent',
            toolCallId: 'call_agent',
          } as BuiltinToolContext,
        );

        expect(mockCreateAgent).toHaveBeenCalledWith('cg_named', expect.anything());
      });
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

  // The builder panel's ConversationContext is keyed by the builtin builder
  // agent, so `ctx.agentId` is that builtin agent — never the group's
  // supervisor. Gateway-disabled parity with the server runtime: the inherited
  // AgentBuilder APIs resolve the group first and target its supervisor.
  describe('inherited supervisor APIs (client runtime parity)', () => {
    const BUILDER_AGENT_ID = 'agt_builtin_group_builder';

    const groupDetail = (id: string, supervisorAgentId: string, memberIds: string[] = []) => ({
      agents: [
        { id: supervisorAgentId, isSupervisor: true },
        ...memberIds.map((memberId) => ({ id: memberId, isSupervisor: false })),
      ],
      id,
      supervisorAgentId,
    });

    beforeEach(() => {
      mockUpdateAgentConfig.mockResolvedValue({ content: 'ok', success: true });
      mockInstallPlugin.mockResolvedValue({ content: 'ok', success: true });
    });

    it('updateConfig targets the supervisor of the group createGroup made, not ctx.agentId', async () => {
      dbMessagesMap = conversationWithCreatedGroup();
      groupMap = {
        cg_1: groupDetail('cg_1', 'agt_old_supervisor'),
        cg_new: groupDetail('cg_new', 'agt_new_supervisor'),
      };

      await groupAgentBuilderExecutor.updateConfig({ config: { model: 'gpt-4o' } }, {
        agentId: BUILDER_AGENT_ID,
        messageId: 'msg_create_agent',
      } as BuiltinToolContext);

      expect(mockUpdateAgentConfig).toHaveBeenCalledWith('agt_new_supervisor', {
        config: { model: 'gpt-4o' },
      });
    });

    it('installPlugin targets the supervisor of the group createGroup made, not ctx.agentId', async () => {
      dbMessagesMap = conversationWithCreatedGroup();
      groupMap = { cg_new: groupDetail('cg_new', 'agt_new_supervisor') };

      await groupAgentBuilderExecutor.installPlugin(
        { identifier: 'web-search', source: 'market' },
        {
          agentId: BUILDER_AGENT_ID,
          messageId: 'msg_create_agent',
        } as BuiltinToolContext,
      );

      expect(mockInstallPlugin).toHaveBeenCalledWith('agt_new_supervisor', {
        identifier: 'web-search',
        source: 'market',
      });
    });

    it('without createGroup, targets the active group supervisor instead of the builder agent', async () => {
      groupMap = { cg_1: groupDetail('cg_1', 'agt_old_supervisor') };

      await groupAgentBuilderExecutor.updateConfig({ config: { model: 'gpt-4o' } }, {
        agentId: BUILDER_AGENT_ID,
      } as BuiltinToolContext);

      expect(mockUpdateAgentConfig).toHaveBeenCalledWith('agt_old_supervisor', expect.anything());
    });

    it('fetches the group detail when the store has not loaded it yet', async () => {
      dbMessagesMap = conversationWithCreatedGroup();
      mockGetGroupDetail.mockResolvedValue(groupDetail('cg_new', 'agt_new_supervisor'));

      await groupAgentBuilderExecutor.installPlugin(
        { identifier: 'web-search', source: 'market' },
        {
          agentId: BUILDER_AGENT_ID,
          messageId: 'msg_create_agent',
        } as BuiltinToolContext,
      );

      expect(mockGetGroupDetail).toHaveBeenCalledWith('cg_new');
      expect(mockInstallPlugin).toHaveBeenCalledWith('agt_new_supervisor', expect.anything());
    });

    it('updateConfig with an explicit member agentId targets that member', async () => {
      dbMessagesMap = conversationWithCreatedGroup();
      groupMap = { cg_new: groupDetail('cg_new', 'agt_new_supervisor', ['agt_member']) };

      await groupAgentBuilderExecutor.updateConfig(
        { agentId: 'agt_member', config: { model: 'gpt-4o' } },
        { agentId: BUILDER_AGENT_ID, messageId: 'msg_create_agent' } as BuiltinToolContext,
      );

      expect(mockUpdateAgentConfig).toHaveBeenCalledWith('agt_member', {
        config: { model: 'gpt-4o' },
      });
    });

    it('updateConfig refuses an agentId outside the resolved group', async () => {
      dbMessagesMap = conversationWithCreatedGroup();
      groupMap = { cg_new: groupDetail('cg_new', 'agt_new_supervisor') };

      const result = await groupAgentBuilderExecutor.updateConfig(
        { agentId: BUILDER_AGENT_ID, config: { model: 'gpt-4o' } },
        { agentId: BUILDER_AGENT_ID, messageId: 'msg_create_agent' } as BuiltinToolContext,
      );

      expect(result).toMatchObject({ error: { type: 'AgentNotFound' }, success: false });
      expect(mockUpdateAgentConfig).not.toHaveBeenCalled();
    });

    it('reports a structured error instead of falling back to ctx.agentId when there is no group', async () => {
      activeGroupId = undefined;

      const config = await groupAgentBuilderExecutor.updateConfig({ config: { model: 'gpt-4o' } }, {
        agentId: BUILDER_AGENT_ID,
      } as BuiltinToolContext);
      const plugin = await groupAgentBuilderExecutor.installPlugin(
        { identifier: 'web-search', source: 'market' },
        { agentId: BUILDER_AGENT_ID } as BuiltinToolContext,
      );

      expect(config).toMatchObject({ error: { type: 'NoAgentContext' }, success: false });
      expect(plugin).toMatchObject({ error: { type: 'NoAgentContext' }, success: false });
      expect(mockUpdateAgentConfig).not.toHaveBeenCalled();
      expect(mockInstallPlugin).not.toHaveBeenCalled();
    });

    it('holds both back while a sibling createGroup is still awaiting approval', async () => {
      dbMessagesMap = {
        'builder-topic': [
          {
            id: 'msg_assistant',
            role: 'assistant',
            tools: [
              {
                apiName: 'createGroup',
                id: 'call_create_group',
                identifier: GroupAgentBuilderIdentifier,
              },
              {
                apiName: 'updateConfig',
                id: 'call_config',
                identifier: GroupAgentBuilderIdentifier,
              },
              {
                apiName: 'installPlugin',
                id: 'call_plugin',
                identifier: GroupAgentBuilderIdentifier,
              },
            ],
          },
          {
            id: 'msg_create_group',
            parentId: 'msg_assistant',
            plugin: { apiName: 'createGroup', identifier: GroupAgentBuilderIdentifier },
            role: 'tool',
            tool_call_id: 'call_create_group',
          },
          {
            id: 'msg_config',
            parentId: 'msg_assistant',
            role: 'tool',
            tool_call_id: 'call_config',
          },
          {
            id: 'msg_plugin',
            parentId: 'msg_assistant',
            role: 'tool',
            tool_call_id: 'call_plugin',
          },
        ],
      };
      groupMap = { cg_1: groupDetail('cg_1', 'agt_old_supervisor') };

      const config = await groupAgentBuilderExecutor.updateConfig({ config: { model: 'gpt-4o' } }, {
        agentId: BUILDER_AGENT_ID,
        anchorMessageId: 'msg_assistant',
        messageId: 'msg_config',
        toolCallId: 'call_config',
      } as BuiltinToolContext);
      const plugin = await groupAgentBuilderExecutor.installPlugin(
        { identifier: 'web-search', source: 'market' },
        {
          agentId: BUILDER_AGENT_ID,
          anchorMessageId: 'msg_assistant',
          messageId: 'msg_plugin',
          toolCallId: 'call_plugin',
        } as BuiltinToolContext,
      );

      for (const result of [config, plugin]) {
        expect(result).toMatchObject({ error: { type: 'AwaitingCreateGroup' }, success: false });
      }
      expect(mockUpdateAgentConfig).not.toHaveBeenCalled();
      expect(mockInstallPlugin).not.toHaveBeenCalled();
    });
  });

  describe('onAfterCall', () => {
    // Under gateway mode the write commits server-side, so this hook is the only
    // thing that re-syncs the group Profile sidebar's member list.
    it('refreshes the group detail after a successful member write', async () => {
      await afterCall(GroupAgentBuilderApiName.batchCreateAgents, { agents: [] }, true);

      expect(mockRefreshGroupDetail).toHaveBeenCalledWith('cg_1');
    });

    it('refreshes the group createGroup made in this conversation', async () => {
      dbMessagesMap = conversationWithCreatedGroup();

      await groupAgentBuilderExecutor.onAfterCall({
        apiName: GroupAgentBuilderApiName.createAgent,
        identifier: GroupAgentBuilderIdentifier,
        params: { title: 'PM' },
        result: { content: '', success: true },
        toolCallId: 'call_create_agent',
      });

      expect(mockRefreshGroupDetail).toHaveBeenCalledWith('cg_new');
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
