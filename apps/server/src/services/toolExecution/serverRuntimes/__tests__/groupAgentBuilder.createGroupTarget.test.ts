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

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { findLatestPluginStateInTopic: mockFindLatestPluginStateInTopic };
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
      topicId: 'tpc_builder',
    });
    expect(mockAddAgentsToGroup).toHaveBeenCalledWith('cg_shell', ['agt_m1']);
  });
});
