import { beforeEach, describe, expect, it, vi } from 'vitest';

import { groupAgentBuilderRuntime } from '../groupAgentBuilder';

const {
  mockAddAgentsToGroup,
  mockBatchCreate,
  mockCreateGroupWithSupervisor,
  mockFindById,
  mockFindLatestPluginStateInTopic,
  mockGetGroupAgentsWithMeta,
  mockUpdateGroup,
} = vi.hoisted(() => ({
  mockAddAgentsToGroup: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockCreateGroupWithSupervisor: vi.fn(),
  mockFindById: vi.fn(),
  mockFindLatestPluginStateInTopic: vi.fn(),
  mockGetGroupAgentsWithMeta: vi.fn(),
  mockUpdateGroup: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return {
      batchCreate: mockBatchCreate,
      getAgentConfigById: vi.fn(async () => null),
      queryAgents: vi.fn(async () => []),
      update: vi.fn(),
      updateConfig: vi.fn(),
    };
  }),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn(function () {
    return {
      addAgentsToGroup: mockAddAgentsToGroup,
      findById: mockFindById,
      getGroupAgentsWithMeta: mockGetGroupAgentsWithMeta,
      removeAgentsFromGroup: vi.fn(),
      update: mockUpdateGroup,
    };
  }),
}));

/** Messages / tool results the fake message model serves, keyed by id / tool call id. */
let assistantMessages: Record<string, { tools?: unknown[] }> = {};
let toolStates: Record<string, Record<string, unknown> | undefined> = {};

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return {
      findById: vi.fn(async (id: string) => assistantMessages[id]),
      findLatestPluginStateInTopic: mockFindLatestPluginStateInTopic,
      findMessagePlugin: vi.fn(async (id: string) =>
        id in toolStates ? { id, state: toolStates[id] } : undefined,
      ),
      findToolMessageIdByToolCallId: vi.fn(async (toolCallId: string) =>
        toolCallId in toolStates ? toolCallId : null,
      ),
    };
  }),
}));

vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: vi.fn(function () {
    return { getAccessLevel: vi.fn(), setAccessLevel: vi.fn() };
  }),
}));

vi.mock('@/database/repositories/agentGroup', () => ({
  AgentGroupRepository: vi.fn(function () {
    return { createGroupWithSupervisor: mockCreateGroupWithSupervisor };
  }),
}));

vi.mock('@/server/services/agentGroup', () => ({
  AgentGroupService: vi.fn(function () {
    return { normalizeGroupConfig: (config: unknown) => config };
  }),
}));

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(async () => undefined),
}));

vi.mock('../agentBuilder', () => ({
  agentBuilderRuntime: {
    factory: () => ({ updateConfig: vi.fn() }),
    identifier: 'lobe-agent-builder',
  },
}));

// Each tool call builds its own runtime, like `getServerRuntime` does per call,
// so nothing can be carried over in memory between calls.
const createRuntime = () =>
  groupAgentBuilderRuntime.factory({
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  });

/**
 * Stand-in for the tool transport: it persists each tool result's `state` on the
 * tool message, which is what a later call in the same topic reads back.
 */
const persistToolState = (topicState: Record<string, unknown> | undefined) =>
  mockFindLatestPluginStateInTopic.mockResolvedValue(topicState);

/**
 * "createGroup succeeds, then every member tool says No active group found".
 * Mirrors the production call sequence recorded in tpc_t7cFeao1KEWW /
 * tpc_Ik31uOJ3BmWG: createGroup → updateGroupPrompt → createAgent /
 * batchCreateAgents / inviteAgent.
 */
describe('group agent builder — members after createGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGroupWithSupervisor.mockResolvedValue({
      group: { id: 'cg_new' },
      supervisorAgentId: 'agt_sup_new',
    });
    mockFindById.mockImplementation(async (id: string) => ({ id, title: id }));
    mockGetGroupAgentsWithMeta.mockResolvedValue([]);
    mockBatchCreate.mockResolvedValue([{ id: 'agt_m1', visibility: 'public' }]);
    mockAddAgentsToGroup.mockResolvedValue({ added: ['agt_x'] });
    mockUpdateGroup.mockResolvedValue({});
    persistToolState(undefined);
  });

  // Run context as it looked on prod for all 12 vents: the run carried no
  // editing group, so only an explicit groupId could name the new group — and
  // the member tools had no such parameter.
  it('without an editing group, member tools reach the group createGroup returned', async () => {
    const ctx = { topicId: 'tpc_builder' } as never;

    const created = await createRuntime().createGroup(
      { title: 'Tim Brainstorming Bisnis' } as never,
      ctx,
    );
    expect(created.success).toBe(true);
    expect(created.content).toContain('cg_new');
    persistToolState(created.state as Record<string, unknown>);

    const promptNoId = await createRuntime().updateGroupPrompt({ prompt: 'x' } as never, ctx);
    const create = await createRuntime().createAgent(
      { systemRole: 'r', title: 'Strategist' } as never,
      ctx,
    );
    const batch = await createRuntime().batchCreateAgents(
      { agents: [{ title: 'A' }] } as never,
      ctx,
    );
    const invite = await createRuntime().inviteAgent({ agentId: 'agt_x' } as never, ctx);

    for (const result of [promptNoId, create, batch, invite]) {
      expect(result.content).not.toBe('No active group found');
      expect(result.success).toBe(true);
    }
    expect(mockAddAgentsToGroup.mock.calls.map(([groupId]) => groupId)).toEqual([
      'cg_new',
      'cg_new',
      'cg_new',
    ]);
  });

  // Still present after the editing target was restored on the run origin: the
  // run is pinned to the group the Home "create group" flow pre-created
  // (editingGroupId), createGroup does not re-target the run, and member tools
  // take no groupId — members silently land in the empty shell group.
  it('members go to the group createGroup just made, not the pinned one', async () => {
    const ctx = { editingGroupId: 'cg_shell', topicId: 'tpc_builder' } as never;

    const created = await createRuntime().createGroup({ title: 'Dev Team' } as never, ctx);
    expect(created.state).toMatchObject({ groupId: 'cg_new' });
    persistToolState(created.state as Record<string, unknown>);

    await createRuntime().createAgent({ systemRole: 'r', title: 'Tech Lead' } as never, ctx);

    expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_new', ['agt_m1']);
  });

  it('an explicit groupId wins over both the pinned and the created group', async () => {
    const ctx = { editingGroupId: 'cg_shell', topicId: 'tpc_builder' } as never;
    persistToolState({ groupId: 'cg_new' });

    await createRuntime().createAgent(
      { groupId: 'cg_named', systemRole: 'r', title: 'Tech Lead' } as never,
      ctx,
    );

    expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_named', ['agt_m1']);
    expect(mockFindLatestPluginStateInTopic).not.toHaveBeenCalled();
  });

  it('keeps the pinned group while the conversation has created none', async () => {
    const ctx = { editingGroupId: 'cg_shell', topicId: 'tpc_builder' } as never;

    await createRuntime().createAgent({ systemRole: 'r', title: 'Tech Lead' } as never, ctx);

    expect(mockFindLatestPluginStateInTopic).toHaveBeenCalledWith({
      apiName: 'createGroup',
      identifier: 'lobe-group-agent-builder',
      threadId: null,
      topicId: 'tpc_builder',
    });
    expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_shell', ['agt_m1']);
  });

  // A builder topic can branch into threads. The created group is read back
  // from the branch the tool call runs in, so a `createGroup` in one thread
  // must not retarget its siblings or the main conversation.
  it('reads the created group back from the current thread only', async () => {
    const threadCtx = {
      editingGroupId: 'cg_shell',
      threadId: 'thd_branch',
      topicId: 'tpc_builder',
    } as never;
    const mainCtx = { editingGroupId: 'cg_shell', topicId: 'tpc_builder' } as never;

    await createRuntime().createAgent({ systemRole: 'r', title: 'Tech Lead' } as never, threadCtx);
    await createRuntime().createAgent({ systemRole: 'r', title: 'Tech Lead' } as never, mainCtx);

    expect(mockFindLatestPluginStateInTopic.mock.calls.map(([params]) => params)).toEqual([
      {
        apiName: 'createGroup',
        identifier: 'lobe-group-agent-builder',
        threadId: 'thd_branch',
        topicId: 'tpc_builder',
      },
      {
        apiName: 'createGroup',
        identifier: 'lobe-group-agent-builder',
        threadId: null,
        topicId: 'tpc_builder',
      },
    ]);
  });
});

/**
 * One assistant message issues createGroup + updateGroup + updateGroupPrompt +
 * createAgent. createGroup needs approval, so GeneralChatAgent runs the other
 * three first; the created-group lookup finds nothing yet and would fall back to
 * the pinned shell group — silently editing the wrong group.
 */
describe('group agent builder — siblings of a createGroup awaiting approval', () => {
  const ctxFor = (toolCallId: string) =>
    ({
      assistantMessageId: 'msg_assistant',
      editingGroupId: 'cg_shell',
      toolCallId,
      topicId: 'tpc_builder',
    }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockImplementation(async (id: string) => ({ id, title: id }));
    mockGetGroupAgentsWithMeta.mockResolvedValue([]);
    mockBatchCreate.mockResolvedValue([{ id: 'agt_m1', visibility: 'public' }]);
    mockAddAgentsToGroup.mockResolvedValue({ added: ['agt_m1'] });
    mockUpdateGroup.mockResolvedValue({});
    // createGroup has not run, so no created group is on record yet.
    persistToolState(undefined);
    assistantMessages = {
      msg_assistant: {
        tools: [
          { apiName: 'createGroup', id: 'call_group', identifier: 'lobe-group-agent-builder' },
          { apiName: 'updateGroup', id: 'call_update', identifier: 'lobe-group-agent-builder' },
          {
            apiName: 'updateGroupPrompt',
            id: 'call_prompt',
            identifier: 'lobe-group-agent-builder',
          },
          { apiName: 'createAgent', id: 'call_agent', identifier: 'lobe-group-agent-builder' },
        ],
      },
    };
    toolStates = {};
  });

  it('refuses dependent writes instead of editing the pinned group', async () => {
    const update = await createRuntime().updateGroup(
      { meta: { title: 'Dev Team' } } as never,
      ctxFor('call_update'),
    );
    const prompt = await createRuntime().updateGroupPrompt(
      { prompt: 'shared' } as never,
      ctxFor('call_prompt'),
    );
    const agent = await createRuntime().createAgent(
      { systemRole: 'r', title: 'Tech Lead' } as never,
      ctxFor('call_agent'),
    );

    for (const result of [update, prompt, agent]) {
      expect(result).toMatchObject({ error: { type: 'AwaitingCreateGroup' }, success: false });
    }
    expect(mockUpdateGroup).not.toHaveBeenCalled();
    expect(mockAddAgentsToGroup).not.toHaveBeenCalled();
  });

  it('runs them on the created group once createGroup has returned', async () => {
    toolStates = { call_group: { groupId: 'cg_new', success: true } };
    persistToolState({ groupId: 'cg_new', success: true });

    await createRuntime().createAgent(
      { systemRole: 'r', title: 'Tech Lead' } as never,
      ctxFor('call_agent'),
    );

    expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_new', ['agt_m1']);
  });

  it('does not hold back a call that names its group', async () => {
    await createRuntime().createAgent(
      { groupId: 'cg_named', systemRole: 'r', title: 'Tech Lead' } as never,
      ctxFor('call_agent'),
    );

    expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_named', ['agt_m1']);
  });

  it('keeps the pinned group when the step has no createGroup', async () => {
    assistantMessages = {
      msg_assistant: {
        tools: [
          { apiName: 'createAgent', id: 'call_agent', identifier: 'lobe-group-agent-builder' },
        ],
      },
    };

    await createRuntime().createAgent(
      { systemRole: 'r', title: 'Tech Lead' } as never,
      ctxFor('call_agent'),
    );

    expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_shell', ['agt_m1']);
  });
});
