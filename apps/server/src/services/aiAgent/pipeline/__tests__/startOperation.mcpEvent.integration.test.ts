// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import type { AgentOperationStatus } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicModel } from '@/database/models/topic';
import { agents, topics, users } from '@/database/schemas';
import { settleTopicRunningMark } from '@/server/services/agentRuntime/CompletionLifecycle/persistence';

import type { ExecRunContext } from '../../types';
import type { StartOperationDeps, StartOperationInput } from '../startOperation';
import { startOperation } from '../startOperation';

vi.mock('@/libs/trpc/utils/internalJwt', () => ({ signUserJWT: vi.fn() }));
const db = await getTestDB();
const userId = 'mcp-inbox-start-user';
const agentId = 'mcp-inbox-start-agent';
const topicId = 'mcp-inbox-start-topic';
const operationId = 'mcp-inbox-operation';
const topicModel = new TopicModel(db, userId);
const read = () => topicModel.findById(topicId);
const finish = (status: AgentOperationStatus) =>
  settleTopicRunningMark({ serverDB: db, userId } as Parameters<typeof settleTopicRunningMark>[0], {
    operationId,
    topicId,
    status,
  });
const ctx = {
  agentConfig: {},
  appContext: { topicId },
  assistantMessageId: 'assistant',
  model: 'model',
  provider: 'provider',
  resolvedAgentId: agentId,
  topicId,
  trigger: RequestTrigger.McpEvent,
  userMessageId: 'message',
} as unknown as ExecRunContext;
const input = (overrides: Record<string, unknown> = {}) =>
  ({
    markTopicRunning: true,
    approvalClaim: {},
    approvalSourceToolMessageIds: [],
    autoStart: true,
    init: {
      discovery: { modelMediaCapabilities: {}, toolsResult: { enabledToolIds: [] } },
      initialContext: {},
      prep: { allMessages: [], deviceSystemInfo: {} },
    },
    operationId,
    updateAbortedAssistantMessage: vi.fn(),
    userInterventionConfig: { approvalMode: 'manual' },
    ...overrides,
  }) as unknown as StartOperationInput;
const setup = () => {
  const createOperation = vi.fn<StartOperationDeps['agentRuntimeService']['createOperation']>();
  const deps = {
    agentRuntimeService: { createOperation },
    messageModel: { update: vi.fn() },
    retirePendingApprovalOperation: vi.fn(),
    topicModel,
    userId,
    withholdGatewayToken: true,
  } as unknown as StartOperationDeps;
  return { deps, createOperation };
};
beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ id: topicId, agentId, userId, status: 'active' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(users).where(eq(users.id, userId));
});

describe('opt-in event runtime topic status without any browser', () => {
  it('marks before dispatch and leaves an extremely fast successful run unread in the Inbox query', async () => {
    const { deps, createOperation } = setup();
    let atDispatch: Awaited<ReturnType<typeof read>>;
    createOperation.mockImplementation(async (params) => {
      await params.onOperationCreated?.(operationId);
      atDispatch = await read();
      // Finish before createOperation returns: startup must not rewrite a settled marker afterward.
      await finish('done');
      return { autoStarted: true, operationId, success: true };
    });
    expect((await startOperation(deps, ctx, input())).success).toBe(true);
    expect((await read())?.status).toBe('unread');
    expect(atDispatch!).toMatchObject({
      status: 'running',
      metadata: { runningOperation: { operationId } },
    });
    expect((await read())?.metadata?.runningOperation).toBeNull();
    expect(
      (await topicModel.queryTopics({ statuses: ['running', 'unread'] })).map((topic) => topic.id),
    ).toContain(topicId);
  });

  it.each(['error', 'interrupted'] as const)(
    'settles %s back to active with no stale marker',
    async (status) => {
      const { deps, createOperation } = setup();
      createOperation.mockImplementation(async (params) => {
        await params.onOperationCreated?.(operationId);
        expect((await read())?.status).toBe('running');
        await finish(status);
        return { autoStarted: true, operationId, success: true };
      });
      expect((await startOperation(deps, ctx, input())).success).toBe(true);
      expect(await read()).toMatchObject({
        status: 'active',
        metadata: { runningOperation: null },
      });
    },
  );

  it('keeps a human-approval pause running and visible in the Inbox query', async () => {
    const { deps, createOperation } = setup();
    createOperation.mockImplementation(async (params) => {
      await params.onOperationCreated?.(operationId);
      await finish('waiting_for_human');
      return { autoStarted: true, operationId, success: true };
    });
    await startOperation(deps, ctx, input());
    expect(await read()).toMatchObject({
      status: 'running',
      metadata: { runningOperation: { operationId } },
    });
    expect(
      (await topicModel.queryTopics({ statuses: ['running', 'unread'] })).map((topic) => topic.id),
    ).toContain(topicId);
  });

  it.each(['before', 'after'] as const)(
    'returns a startup error without leaving running when dispatch fails %s preparation',
    async (phase) => {
      const { deps, createOperation } = setup();
      createOperation.mockImplementation(async (params) => {
        if (phase === 'after') await params.onOperationCreated?.(operationId);
        throw new Error('queue refused the operation');
      });
      const result = await startOperation(deps, ctx, input());
      expect(result).toMatchObject({ success: false, error: 'queue refused the operation' });
      expect((await read())?.status).toBe('active');
      expect((await read())?.metadata?.runningOperation ?? null).toBeNull();
    },
  );

  it('settles an aborted startup before rethrowing', async () => {
    const { deps, createOperation } = setup();
    createOperation.mockImplementation(async (params) => {
      await params.onOperationCreated?.(operationId);
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(startOperation(deps, ctx, input())).rejects.toThrow('aborted');
    expect((await read())?.status).toBe('active');
    expect((await read())?.metadata?.runningOperation ?? null).toBeNull();
  });

  it('does not overwrite a newer operation while cleaning up a failed startup', async () => {
    const { deps, createOperation } = setup();
    createOperation.mockImplementation(async (params) => {
      await params.onOperationCreated?.(operationId);
      await topicModel.updateMetadata(topicId, {
        runningOperation: { operationId: 'newer-operation' },
      });
      throw new Error('late failure');
    });
    await startOperation(deps, ctx, input());
    expect(await read()).toMatchObject({
      status: 'running',
      metadata: { runningOperation: { operationId: 'newer-operation' } },
    });
  });

  it('cleans up when auto-start was requested but no step was scheduled', async () => {
    const { deps, createOperation } = setup();
    createOperation.mockImplementation(async (params) => {
      await params.onOperationCreated?.(operationId);
      return { autoStarted: false, operationId, success: true };
    });
    await startOperation(deps, ctx, input());
    expect((await read())?.status).toBe('active');
    expect((await read())?.metadata?.runningOperation).toBeNull();
  });

  it.each([{ isolationThread: true }, { threadId: 'isolated-thread' }])(
    'does not claim a parent topic status for a thread run: %j',
    async (appContext) => {
      const { deps, createOperation } = setup();
      createOperation.mockImplementation(async (params) => {
        await params.onOperationCreated?.(operationId);
        return { autoStarted: true, operationId, success: true };
      });
      await startOperation(deps, { ...ctx, appContext: { topicId, ...appContext } }, input());
      expect((await read())?.status).toBe('active');
      expect((await read())?.metadata?.runningOperation ?? null).toBeNull();
    },
  );

  it.each([
    RequestTrigger.Scm,
    RequestTrigger.Eval,
    RequestTrigger.Api,
    RequestTrigger.Cli,
    RequestTrigger.Chat,
    RequestTrigger.McpEvent,
  ])('leaves %s unchanged without the explicit opt-in', async (trigger) => {
    const { deps, createOperation } = setup();
    createOperation.mockImplementation(async (params) => {
      await params.onOperationCreated?.(operationId);
      return { autoStarted: true, operationId, success: true };
    });
    await startOperation(deps, { ...ctx, trigger }, input({ markTopicRunning: undefined }));
    await finish('done');
    expect((await read())?.status).toBe('active');
  });
});
