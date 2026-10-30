// @vitest-environment node
import { ThreadType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubagentNameConflictError, SubagentParentNotFoundError } from '@/database/models/subagent';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

const mockAssertCanEdit = vi.fn();
const mockConfigAccess = vi.fn();
const mockFindTopic = vi.fn();

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: (...args: unknown[]) => mockAssertCanEdit(...args),
}));

vi.mock('../_helpers/resourceConfigGuard', () => ({
  getResourceConfigAccess: (...args: unknown[]) => mockConfigAccess(...args),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: mockFindTopic };
  }),
}));

const subagentMocks = {
  create: vi.fn(),
  delete: vi.fn(),
  findById: vi.fn(),
  queryByParentAgentId: vi.fn(),
  update: vi.fn(),
};
const threadMocks = {
  countBySubagentIds: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  queryBySubagentId: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/database/models/subagent', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    SubagentModel: vi.fn(function () {
      return subagentMocks;
    }),
  };
});

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn(function () {
    return threadMocks;
  }),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { create: vi.fn() };
  }),
}));

const { subagentRouter } = await import('../subagent');
const { threadRouter } = await import('../thread');

const preset = { id: 'sub_1', name: 'coder', parentAgentId: 'agt_1' };

describe('subagentRouter', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1' };

  beforeEach(() => {
    vi.resetAllMocks();
    mockConfigAccess.mockResolvedValue('full');
    mockAssertCanEdit.mockResolvedValue(undefined);
    mockFindTopic.mockResolvedValue({ agentId: 'agt_1' });
  });

  it('maps a duplicate name to CONFLICT', async () => {
    subagentMocks.create.mockRejectedValue(new SubagentNameConflictError('coder'));
    const caller = subagentRouter.createCaller(ctx);

    await expect(
      caller.createSubagent({ name: 'coder', parentAgentId: 'agt_1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'DUPLICATE_SUBAGENT_NAME' });
  });

  it('maps an invisible parent agent to NOT_FOUND', async () => {
    subagentMocks.create.mockRejectedValue(new SubagentParentNotFoundError('agt_x'));
    const caller = subagentRouter.createCaller(ctx);

    await expect(
      caller.createSubagent({ name: 'coder', parentAgentId: 'agt_x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps a rename conflict to CONFLICT', async () => {
    subagentMocks.findById.mockResolvedValue(preset);
    subagentMocks.update.mockRejectedValue(new SubagentNameConflictError('writer'));
    const caller = subagentRouter.createCaller(ctx);

    await expect(
      caller.updateSubagent({ id: 'sub_1', value: { name: 'writer' } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('requires edit access on the parent agent for every write', async () => {
    mockAssertCanEdit.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN' }));
    subagentMocks.findById.mockResolvedValue(preset);
    const caller = subagentRouter.createCaller({ ...ctx, workspaceId: 'ws-1' });

    await expect(
      caller.createSubagent({ name: 'x', parentAgentId: 'agt_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.updateSubagent({ id: 'sub_1', value: {} })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.removeSubagent({ id: 'sub_1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    expect(mockAssertCanEdit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agt_1', resourceType: 'agent', workspaceId: 'ws-1' }),
    );
    expect(subagentMocks.create).not.toHaveBeenCalled();
    expect(subagentMocks.update).not.toHaveBeenCalled();
    expect(subagentMocks.delete).not.toHaveBeenCalled();
  });

  it('redacts config for profile-only members and hides presets without access', async () => {
    const full = { ...preset, model: 'm', provider: 'p', systemRole: 'secret', tools: ['t'] };
    subagentMocks.findById.mockResolvedValue(full);
    subagentMocks.queryByParentAgentId.mockResolvedValue([full]);
    const caller = subagentRouter.createCaller(ctx);

    mockConfigAccess.mockResolvedValue('profile');
    const redacted = { model: null, name: 'coder', provider: null, systemRole: null, tools: null };
    await expect(caller.getSubagent({ id: 'sub_1' })).resolves.toMatchObject(redacted);
    expect((await caller.getSubagents({ parentAgentId: 'agt_1' }))[0]).toMatchObject(redacted);

    mockConfigAccess.mockResolvedValue('none');
    await expect(caller.getSubagent({ id: 'sub_1' })).resolves.toBeNull();
    await expect(caller.getSubagents({ parentAgentId: 'agt_1' })).resolves.toEqual([]);
    await expect(caller.getSubagentStats({ parentAgentId: 'agt_1' })).resolves.toEqual([]);
    await expect(caller.getSubagentThreads({ subagentId: 'sub_1' })).resolves.toEqual([]);
    expect(threadMocks.queryBySubagentId).not.toHaveBeenCalled();
  });

  it('reports stats for the presets of one parent agent', async () => {
    subagentMocks.queryByParentAgentId.mockResolvedValue([preset, { ...preset, id: 'sub_2' }]);
    threadMocks.countBySubagentIds.mockResolvedValue([
      { subagentId: 'sub_1', threadCount: 2, totalTokens: 10 },
    ]);
    const caller = subagentRouter.createCaller(ctx);

    await expect(caller.getSubagentStats({ parentAgentId: 'agt_1' })).resolves.toEqual([
      { subagentId: 'sub_1', threadCount: 2, totalTokens: 10 },
    ]);
    expect(threadMocks.countBySubagentIds).toHaveBeenCalledWith(['sub_1', 'sub_2']);
  });
});

describe('threadRouter subagent attribution', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1' };

  beforeEach(() => {
    vi.resetAllMocks();
    mockConfigAccess.mockResolvedValue('full');
    mockAssertCanEdit.mockResolvedValue(undefined);
    mockFindTopic.mockResolvedValue({ agentId: 'agt_1' });
  });

  it('writes subagentId when the preset is visible', async () => {
    subagentMocks.findById.mockResolvedValue(preset);
    threadMocks.create.mockResolvedValue({ id: 'thd_1' });
    const caller = threadRouter.createCaller(ctx);

    await caller.createThread({
      subagentId: 'sub_1',
      topicId: 'tpc_1',
      type: ThreadType.Isolation,
    });

    expect(threadMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ subagentId: 'sub_1' }),
    );
  });

  it('rejects a preset the caller cannot see', async () => {
    subagentMocks.findById.mockResolvedValue(undefined);
    const caller = threadRouter.createCaller(ctx);

    await expect(
      caller.createThread({ subagentId: 'sub_x', topicId: 'tpc_1', type: ThreadType.Isolation }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.updateThread({ id: 'thd_1', value: { subagentId: 'sub_x' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(threadMocks.create).not.toHaveBeenCalled();
    expect(threadMocks.update).not.toHaveBeenCalled();
  });

  it('rejects a preset of another agent than the topic agent', async () => {
    subagentMocks.findById.mockResolvedValue(preset);
    mockFindTopic.mockResolvedValue({ agentId: 'agt_other' });
    const caller = threadRouter.createCaller(ctx);

    await expect(
      caller.createThread({ subagentId: 'sub_1', topicId: 'tpc_1', type: ThreadType.Isolation }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(threadMocks.create).not.toHaveBeenCalled();
  });

  it('re-checks the kept preset when a thread moves to another topic', async () => {
    threadMocks.findById.mockResolvedValue({
      subagentId: 'sub_1',
      topicId: 'tpc_1',
      userId: 'user-1',
    });
    subagentMocks.findById.mockResolvedValue(preset);
    mockFindTopic.mockResolvedValue({ agentId: 'agt_other' });
    const caller = threadRouter.createCaller(ctx);

    await expect(
      caller.updateThread({ id: 'thd_1', value: { topicId: 'tpc_2' } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockFindTopic).toHaveBeenCalledWith('tpc_2');
    expect(threadMocks.update).not.toHaveBeenCalled();
  });

  it('creates main-agent threads without a preset lookup', async () => {
    threadMocks.create.mockResolvedValue({ id: 'thd_2' });
    const caller = threadRouter.createCaller(ctx);

    await caller.createThread({ topicId: 'tpc_1', type: ThreadType.Isolation });

    expect(subagentMocks.findById).not.toHaveBeenCalled();
  });
});
