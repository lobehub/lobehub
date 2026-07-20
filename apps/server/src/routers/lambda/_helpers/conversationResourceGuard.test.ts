// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertCanPerformResourceAction,
  getResourceMeta,
} from '@/server/services/resourcePermission';

import {
  assertCanUseConversationTargets,
  assertCanUseCreateMessageTargets,
  assertCanUseMessageTargets,
  assertCanUseSessionTargets,
  assertCanUseTopicTargets,
} from './conversationResourceGuard';
import { getWorkspaceAgentParentGroupIds } from './workspaceAgentGuard';

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
}));
vi.mock('./workspaceAgentGuard', () => ({
  getWorkspaceAgentParentGroupIds: vi.fn(),
}));

const getResourceMetaMock = vi.mocked(getResourceMeta);
const assertActionMock = vi.mocked(assertCanPerformResourceAction);
const getParentGroupIdsMock = vi.mocked(getWorkspaceAgentParentGroupIds);

/** Minimal drizzle stub: every select().from().where() resolves `rows`. */
const createDb = (rowsPerCall: any[][]) => {
  let call = 0;
  return {
    select: () => ({
      from: () => ({
        where: async () => rowsPerCall[call++] ?? [],
      }),
    }),
  } as any;
};

const baseCtx = (db: any, workspaceId: string | null = 'ws-1') => ({
  db,
  userId: 'user-1',
  workspaceId,
});

const wsMeta = { userId: 'creator', visibility: 'public', workspaceId: 'ws-1' };

beforeEach(() => {
  vi.clearAllMocks();
  getResourceMetaMock.mockResolvedValue(wsMeta as any);
  getParentGroupIdsMock.mockResolvedValue([]);
});

describe('assertCanUseConversationTargets', () => {
  it('no-ops in personal mode', async () => {
    await assertCanUseConversationTargets(baseCtx(createDb([]), null), [{ agentId: 'agent-1' }]);

    expect(getResourceMetaMock).not.toHaveBeenCalled();
    expect(assertActionMock).not.toHaveBeenCalled();
  });

  it('asserts `use` on the agent of each deduped target', async () => {
    await assertCanUseConversationTargets(baseCtx(createDb([])), [
      { agentId: 'agent-1' },
      { agentId: 'agent-1' },
    ]);

    expect(assertActionMock).toHaveBeenCalledTimes(1);
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'use',
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    );
  });

  it('checks both the group and agent when both contexts are supplied', async () => {
    await assertCanUseConversationTargets(baseCtx(createDb([])), [
      { agentId: 'supervisor-1', groupId: 'group-1' },
    ]);

    expect(assertActionMock).toHaveBeenCalledTimes(2);
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'group-1', resourceType: 'agentGroup' }),
    );
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'supervisor-1', resourceType: 'agent' }),
    );
  });

  it('also checks parent groups for an agent-only virtual member target', async () => {
    getParentGroupIdsMock.mockResolvedValueOnce(['group-1']);

    await assertCanUseConversationTargets(baseCtx(createDb([])), [{ agentId: 'agent-1' }]);

    expect(assertActionMock).toHaveBeenCalledTimes(2);
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agent-1', resourceType: 'agent' }),
    );
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'group-1', resourceType: 'agentGroup' }),
    );
  });

  it('skips resources that do not belong to the current workspace', async () => {
    getResourceMetaMock.mockResolvedValueOnce({ ...wsMeta, workspaceId: 'other-ws' } as any);

    await assertCanUseConversationTargets(baseCtx(createDb([])), [{ agentId: 'agent-1' }]);

    expect(assertActionMock).not.toHaveBeenCalled();
  });

  it('propagates FORBIDDEN from the permission assert', async () => {
    assertActionMock.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(
      assertCanUseConversationTargets(baseCtx(createDb([])), [{ agentId: 'agent-1' }]),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('assertCanUseMessageTargets', () => {
  it('resolves the owning agent from the message rows', async () => {
    const db = createDb([[{ agentId: 'agent-1', groupId: null, topicId: 't-1' }]]);

    await assertCanUseMessageTargets(baseCtx(db), ['msg-1']);

    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agent-1', resourceType: 'agent' }),
    );
  });

  it('falls back to the topic linkage when the row has no agent/group', async () => {
    const db = createDb([
      [{ agentId: null, groupId: null, topicId: 't-1' }],
      [{ agentId: 'agent-2', groupId: null }],
    ]);

    await assertCanUseMessageTargets(baseCtx(db), ['msg-1']);

    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agent-2', resourceType: 'agent' }),
    );
  });

  it('no-ops without ids or workspace', async () => {
    await assertCanUseMessageTargets(baseCtx(createDb([]), null), ['msg-1']);
    await assertCanUseMessageTargets(baseCtx(createDb([])), []);

    expect(assertActionMock).not.toHaveBeenCalled();
  });
});

describe('assertCanUseTopicTargets', () => {
  it('resolves the owning group from the topic rows', async () => {
    const db = createDb([[{ agentId: null, groupId: 'group-1' }]]);

    await assertCanUseTopicTargets(baseCtx(db), ['t-1']);

    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'group-1', resourceType: 'agentGroup' }),
    );
  });
});

describe('assertCanUseSessionTargets', () => {
  it('resolves the linked agent from agentsToSessions and asserts use', async () => {
    const db = createDb([[{ agentId: 'agent-1' }]]);

    await assertCanUseSessionTargets(baseCtx(db), ['session-1']);

    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'use', resourceId: 'agent-1', resourceType: 'agent' }),
    );
  });

  it('no-ops without ids or workspace', async () => {
    await assertCanUseSessionTargets(baseCtx(createDb([]), null), ['session-1']);
    await assertCanUseSessionTargets(baseCtx(createDb([])), []);

    expect(assertActionMock).not.toHaveBeenCalled();
  });
});

describe('assertCanUseCreateMessageTargets', () => {
  it('guards topic and existing parent rows even when explicit context is omitted', async () => {
    const db = createDb([
      [{ agentId: null, groupId: 'group-1', sessionId: null }],
      [{ agentId: 'agent-2', groupId: null, topicId: 'topic-1' }],
    ]);

    await assertCanUseCreateMessageTargets(baseCtx(db), [
      { parentId: 'parent-1', topicId: 'topic-1' },
    ]);

    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'group-1', resourceType: 'agentGroup' }),
    );
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agent-2', resourceType: 'agent' }),
    );
  });

  it('also guards the explicit target so forged context cannot replace row authority', async () => {
    const db = createDb([[], []]);

    await assertCanUseCreateMessageTargets(baseCtx(db), [
      { agentId: 'agent-1', parentId: 'parent-1', topicId: 'topic-1' },
    ]);

    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agent-1', resourceType: 'agent' }),
    );
  });
});
