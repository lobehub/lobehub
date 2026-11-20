// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, threads, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSteerQueueRouter } from '../agentSteerQueue';
import { createTestUser } from './integration/setup';

const { append } = vi.hoisted(() => ({ append: vi.fn() }));

vi.mock('@/server/services/redis', () => ({
  redisService: { steerQueue: { append, remove: vi.fn() } },
}));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent: vi.fn(),
}));
vi.mock('@/server/routers/lambda/aiAgent/guards', () => ({
  assertCanUseAgentRunConversation: vi.fn(),
}));
vi.mock('@/business/server/trpc-middlewares/rbacPermission', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { withScopedPermission: () => mod.trpc.middleware(async (opts: any) => opts.next()) };
});
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));

let db: LobeChatDatabase;
let userId: string;
let topicId: string;
let threadId: string;

const appendTo = (scope: { threadId?: string }) =>
  agentSteerQueueRouter.createCaller({ serverDB: db, userId } as any).append({
    request: { agentId: 'agt-1', appContext: { topicId, ...scope }, prompt: 'follow-up' },
  });

const startRun = async (values: Partial<typeof agentOperations.$inferInsert>) => {
  const id = `op_${Math.random().toString(36).slice(2)}`;
  await db.insert(agentOperations).values({ id, status: 'running', topicId, userId, ...values });
  return id;
};

describe('agentSteerQueueRouter.append — live run on the requested surface', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    append.mockResolvedValue(1);
    db = await getTestDB();
    userId = await createTestUser(db);
    topicId = `tpc_${Math.random().toString(36).slice(2)}`;
    threadId = `thd_${Math.random().toString(36).slice(2)}`;
    await db.insert(topics).values({ id: topicId, userId });
    await db.insert(threads).values({ id: threadId, topicId, type: 'continuation', userId });
  });

  it('queues behind a live thread run, which never claims the topic marker', async () => {
    const threadRun = await startRun({ threadId });

    await expect(appendTo({ threadId })).resolves.toMatchObject({ queued: true });
    expect(append.mock.calls[0][0]).toEqual({ threadId, topicId, userId });
    expect(append.mock.calls[0][2]).toBe(threadRun);
  });

  it('does not queue on a thread while only the main spine is running', async () => {
    await startRun({});

    await expect(appendTo({ threadId })).resolves.toEqual({ queued: false, reason: 'idle' });
    await expect(appendTo({})).resolves.toMatchObject({ queued: true });
  });

  it('ignores child runs, finished runs and other users’ runs', async () => {
    const otherUser = await createTestUser(db);
    await startRun({ parentOperationId: 'op_parent' });
    await startRun({ status: 'done' });
    await startRun({ userId: otherUser });

    await expect(appendTo({})).resolves.toEqual({ queued: false, reason: 'idle' });
    expect(append).not.toHaveBeenCalled();
  });
});
