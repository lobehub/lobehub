// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

import { assertCanUseWorkspaceAgent } from './workspaceAgentGuard';

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(),
}));

const assertActionMock = vi.mocked(assertCanPerformResourceAction);

const createDB = (agent: { id: string } | undefined, linkedGroups: { groupId: string }[] = []) => {
  const where = vi.fn().mockResolvedValue(linkedGroups);
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  const select = vi.fn().mockReturnValue({ from });
  const findFirst = vi.fn().mockResolvedValue(agent);

  return {
    db: { query: { agents: { findFirst } }, select } as unknown as LobeChatDatabase,
    findFirst,
    select,
  };
};

describe('assertCanUseWorkspaceAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertActionMock.mockResolvedValue();
  });

  it('is a no-op outside a workspace', async () => {
    const { db, findFirst } = createDB({ id: 'agent-1' });

    await assertCanUseWorkspaceAgent({ agentId: 'agent-1', db, userId: 'user-1' });

    expect(findFirst).not.toHaveBeenCalled();
    expect(assertActionMock).not.toHaveBeenCalled();
  });

  it('checks only the agent for a standalone workspace agent', async () => {
    const { db, findFirst } = createDB({ id: 'agent-1' });

    await assertCanUseWorkspaceAgent({
      agentId: 'agent-1',
      db,
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(findFirst).not.toHaveBeenCalled();
    expect(assertActionMock).toHaveBeenCalledOnce();
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agent-1', resourceType: 'agent' }),
    );
  });

  it('also checks every parent group for a group-owned virtual agent', async () => {
    const { db } = createDB({ id: 'agent-1' }, [{ groupId: 'group-1' }, { groupId: 'group-2' }]);

    await assertCanUseWorkspaceAgent({
      agentId: 'agent-1',
      db,
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(assertActionMock).toHaveBeenCalledTimes(3);
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'group-1', resourceType: 'agentGroup' }),
    );
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'group-2', resourceType: 'agentGroup' }),
    );
  });

  it('blocks direct execution when a parent group denies use', async () => {
    const { db } = createDB({ id: 'agent-1' }, [{ groupId: 'group-1' }]);
    assertActionMock.mockImplementation(async ({ resourceType }) => {
      if (resourceType === 'agentGroup') throw new Error('group use denied');
    });

    await expect(
      assertCanUseWorkspaceAgent({
        agentId: 'agent-1',
        db,
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    ).rejects.toThrow('group use denied');
  });

  it('checks an explicit group context for a non-virtual member agent', async () => {
    const { db } = createDB({ id: 'agent-1' });

    await assertCanUseWorkspaceAgent({
      agentId: 'agent-1',
      db,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(assertActionMock).toHaveBeenCalledTimes(2);
    expect(assertActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'group-1', resourceType: 'agentGroup' }),
    );
  });

  it('preserves downstream not-found behavior when the identifier does not resolve', async () => {
    const { db } = createDB(undefined);

    await assertCanUseWorkspaceAgent({
      db,
      slug: 'missing-agent',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(assertActionMock).not.toHaveBeenCalled();
  });
});
