// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { MessageModel } from '@/database/models/message';
import { agentOperations, agents, topics, users } from '@/database/schemas';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import { McpElicitationService } from '@/server/services/mcp/elicitation/McpElicitationService';

import { mcpElicitationRouter } from '../mcpElicitation';

// Authentication/transport boundaries only; identity, receipts and archives use the real DB.
vi.mock('@/server/routers/lambda/aiAgent/procedures', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { aiAgentBaseProcedure: trpc.procedure };
});
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { requireWorkspaceRoleWhenScoped: () => trpc.middleware((opts) => opts.next()) };
});
vi.mock('@/business/server/trpc-middlewares/rbacPermission', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { withScopedPermission: () => trpc.middleware((opts) => opts.next()) };
});
vi.mock('@/server/services/file/impls', () => ({ createFileServiceModule: () => ({}) }));
const probes = vi.hoisted(() => ({
  control: vi.fn(async ({ result }) => ({ result, blocked: false, cancelled: false })),
}));
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: class {
    constructor(
      private db: typeof db,
      private userId: string,
      private options: { workspaceId?: string },
    ) {}
    createMcpElicitationService = () =>
      new McpElicitationService(this.db, this.userId, this.options.workspaceId, undefined, {
        executeTool: vi.fn(),
        isOperationInterrupted: async () => false,
        getToolResultPolicy: async () => ({ canReadArchive: true }),
        controlCompletedToolResult: probes.control,
        tryResumeParentFromAsyncTool: vi.fn(),
      });
  },
}));
const db = await getTestDB();
const userId = 'native-receipt-owner';
const messages = new MessageModel(db, userId);
const identity = {
  operationId: 'mcp_client_native_receipt',
  assistantMessageId: 'native-assistant',
  toolMessageId: 'native-tool',
  toolCallId: 'call_1',
  identifier: 'fixture',
  apiName: 'form',
};
const caller = (owner = userId) =>
  mcpElicitationRouter.createCaller({ serverDB: db, userId: owner } as never);
const setPolicy = async (limit: number) => {
  await db
    .update(agentOperations)
    .set({
      metadata: {
        clientMcpStep: {
          assistantMessageId: identity.assistantMessageId,
          toolMessageIds: [identity.toolMessageId],
          owner: randomUUID(),
          leaseUntil: Date.now() - 1000,
          deadline: Date.now() + 60000,
          resultPolicy: { limit, canReadArchive: true },
        },
      },
    })
    .where(eq(agentOperations.id, identity.operationId));
};
beforeEach(async () => {
  vi.clearAllMocks();
  probes.control.mockImplementation(async ({ result }) => ({
    result,
    blocked: false,
    cancelled: false,
  }));
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: 'native-agent', userId });
  await db.insert(topics).values({ id: 'native-topic', userId, agentId: 'native-agent' });
  await db.insert(agentOperations).values({
    id: identity.operationId,
    userId,
    agentId: 'native-agent',
    topicId: 'native-topic',
    status: 'waiting_for_client',
    model: 'original-model',
    provider: 'original-provider',
  });
  const tool = {
    id: identity.toolCallId,
    identifier: 'fixture',
    apiName: 'form',
    arguments: '{}',
    type: 'mcp' as const,
  };
  await messages.create(
    {
      role: 'assistant',
      content: '',
      agentId: 'native-agent',
      topicId: 'native-topic',
      metadata: { operationId: identity.operationId },
      tools: [tool],
    },
    identity.assistantMessageId,
  );
  await messages.create(
    {
      role: 'tool',
      content: '',
      agentId: 'native-agent',
      topicId: 'native-topic',
      parentId: identity.assistantMessageId,
      plugin: tool,
      tool_call_id: tool.id,
    },
    identity.toolMessageId,
  );
  await setPolicy(32);
});
afterAll(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});
afterEach(() => vi.restoreAllMocks());

it.each([32, 80000])(
  'publishes a renderer-free native receipt using the saved %s-character policy',
  async (limit) => {
    await setPolicy(limit);
    const full = 'first line\n' + 'native result line\n'.repeat(3000) + 'tail:native-receipt';
    const state = {
      mcpApp: {
        resourceUri: 'ui://fixture/view',
        server: 'server-fingerprint',
        deviceId: 'origin-desktop',
      },
    };
    const input = { identity, result: { content: full, state, success: true } };
    await expect(caller().producerResult(input)).resolves.toEqual({ success: true });
    const saved = (await messages.findById(identity.toolMessageId))!.content;
    if (limit > full.length) expect(saved).toBe(full);
    else {
      expect(saved).toContain('Full content archived');
      expect(saved).not.toContain('tail:native-receipt');
      const path = saved.match(/Path: (.+)/)![1];
      expect(
        (
          await new AgentDocumentVfsService(db, userId).read(path, {
            agentId: 'native-agent',
            topicId: 'native-topic',
          })
        ).content,
      ).toBe(full);
    }
    expect((await messages.findMessagePlugin(identity.toolMessageId))?.state).toMatchObject({
      ...state,
      mcpClientComplete: true,
    });
    const ready = await caller().clientSteps({ topicId: 'native-topic' });
    expect(ready).toHaveLength(1);
    // ACK loss: a fresh caller sees the same first receipt, without re-finalizing the preview.
    await caller().producerResult({
      identity,
      result: { content: 'duplicate changed output', success: true },
    });
    expect((await messages.findById(identity.toolMessageId))!.content).toBe(saved);
    expect(probes.control).toHaveBeenCalledOnce();
    await expect(
      caller().leaseClientStep({ operationId: identity.operationId, owner: randomUUID() }),
    ).resolves.toMatchObject({
      model: 'original-model',
      provider: 'original-provider',
      toolMessageId: identity.toolMessageId,
    });
    await expect(
      caller().leaseClientStep({ operationId: identity.operationId, owner: randomUUID() }),
    ).resolves.toBeUndefined();
  },
);

it('applies result control before archiving and never retains denied native content', async () => {
  probes.control.mockImplementationOnce(async () => ({
    result: {
      content: 'blocked by policy',
      success: false,
      error: { message: 'blocked by policy' },
      state: { type: 'blocked' },
    },
    blocked: true,
    cancelled: false,
  }));
  await caller().producerResult({
    identity,
    result: { content: 'private native output'.repeat(10000), success: true },
  });
  expect((await messages.findById(identity.toolMessageId))?.content).toBe('blocked by policy');
  expect((await messages.findMessagePlugin(identity.toolMessageId))?.error).toMatchObject({
    message: 'blocked by policy',
  });
  expect(
    await new AgentDocumentVfsService(db, userId).stat('./.tool-results', {
      agentId: 'native-agent',
      topicId: 'native-topic',
    }),
  ).toBeUndefined();
});

it('retries an unpublished native receipt after a transient database failure instead of acknowledging its loss', async () => {
  probes.control.mockImplementationOnce(async ({ result }) => {
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('transient receipt write failure'));
    return { result, blocked: false, cancelled: false };
  });
  const input = { identity, result: { content: 'saved once', success: true } };
  await expect(caller().producerResult(input)).rejects.toThrow('could not be saved');
  expect((await messages.findById(identity.toolMessageId))?.content).toBe('');
  await caller().producerResult(input);
  expect((await messages.findById(identity.toolMessageId))?.content).toBe('saved once');
});

it('rejects another user and a forged source message before publishing a receipt', async () => {
  const input = { identity, result: { content: 'forged', success: true } };
  await expect(caller('another-user').producerResult(input)).rejects.toThrow();
  await expect(
    caller().producerResult({
      ...input,
      identity: { ...identity, toolMessageId: 'unrelated-row' },
    }),
  ).rejects.toThrow();
  expect((await messages.findById(identity.toolMessageId))?.content).toBe('');
});
