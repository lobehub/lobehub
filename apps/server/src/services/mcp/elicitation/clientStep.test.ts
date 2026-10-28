// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { agentOperations, agents, topics, users } from '@/database/schemas';

import { getTestDB } from '../../../../../../packages/database/src/core/getTestDB';
import { cancelClientMcpStep, executeClientMcpTool, registerClientMcpStep } from './clientStep';
import { McpElicitationService } from './McpElicitationService';

const probes = vi.hoisted(() => ({ execute: vi.fn(), manifest: vi.fn(), schedule: vi.fn() }));
vi.mock('@/server/services/queue', () => ({
  QueueService: class {
    getImpl() {
      return {};
    }
    scheduleMessage = probes.schedule;
  },
}));
vi.mock('./resume', () => ({ resolveMcpInvocationManifest: probes.manifest }));
const db = await getTestDB();
const userId = 'mcp-client-step-test';
const messages = new MessageModel(db, userId);
const service = new McpElicitationService(db, userId, undefined, undefined, {
  executeTool: probes.execute,
  controlCompletedToolResult: async ({ result }) => ({ result, blocked: false, cancelled: false }),
  tryResumeParentFromAsyncTool: vi.fn(),
});
const tool = {
  apiName: 'form',
  identifier: 'fixture',
  id: 'call_1',
  type: 'mcp' as const,
  arguments: '{}',
};
const register = (owner = randomUUID()) =>
  registerClientMcpStep(service, {
    assistantMessageId: 'client-assistant',
    toolMessageIds: ['client-tool'],
    owner,
  });
beforeEach(async () => {
  vi.clearAllMocks();
  probes.schedule.mockResolvedValue('queued');
  probes.execute.mockResolvedValue({ content: 'saved-once', success: true, executionTime: 1 });
  probes.manifest.mockResolvedValue({
    identifier: 'fixture',
    mcpParams: { type: 'http', url: 'https://example.com' },
  });
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: 'client-agent', userId });
  await db.insert(topics).values({ id: 'client-topic', userId, agentId: 'client-agent' });
  await messages.create(
    {
      role: 'assistant',
      content: '',
      agentId: 'client-agent',
      topicId: 'client-topic',
      model: 'original-model',
      provider: 'original-provider',
      tools: [tool],
    },
    'client-assistant',
  );
  await messages.create(
    {
      role: 'tool',
      content: '',
      agentId: 'client-agent',
      topicId: 'client-topic',
      parentId: 'client-assistant',
      plugin: tool,
      tool_call_id: tool.id,
    },
    'client-tool',
  );
});
afterAll(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});
describe('durable client MCP host without Agent Gateway', () => {
  it('accepts an executable subset beside approval tools, but cold recovery waits for the entire original assistant batch', async () => {
    const builtin = { ...tool, id: 'approval_2', type: 'builtin' as const, identifier: 'other' };
    await messages.update('client-assistant', { tools: [tool, builtin] });
    const owner = randomUUID();
    const { operationId } = await register(owner);
    const operation = (await service.operations.findById(operationId))!;
    await db
      .update(agentOperations)
      .set({
        metadata: {
          ...operation.metadata,
          clientMcpStep: { ...operation.metadata!.clientMcpStep, leaseUntil: 0 },
        },
      })
      .where(eq(agentOperations.id, operationId));
    await messages.updateToolMessage('client-tool', { content: 'MCP finished' });
    expect(await service.invocations.leaseClientStep(operationId, randomUUID())).toBeUndefined();
    await messages.create(
      {
        role: 'tool',
        content: 'approved sibling finished',
        agentId: 'client-agent',
        topicId: 'client-topic',
        parentId: 'client-assistant',
        plugin: builtin,
        tool_call_id: builtin.id,
      },
      'approval-row',
    );
    const duplicate = 'other-client-anchor';
    await service.operations.recordStart({
      operationId: duplicate,
      agentId: 'client-agent',
      topicId: 'client-topic',
      metadata: {
        ...operation.metadata,
        clientMcpStep: { ...operation.metadata!.clientMcpStep, leaseUntil: 0 },
      },
    });
    const claims = await Promise.all(
      [operationId, duplicate].map((id) => service.invocations.leaseClientStep(id, randomUUID())),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
  it('cancels only the live client owner and prevents an unsent tool from entering the wire', async () => {
    const owner = randomUUID();
    const { operationId } = await register(owner);
    expect(await service.invocations.cancelClientStep(operationId, randomUUID())).toBe(false);
    expect(await cancelClientMcpStep(service, operationId, owner)).toBe(true);
    expect((await messages.findMessagePlugin('client-tool'))?.error?.type).toBe(
      'MCP_CLIENT_TOOL_CANCELLED',
    );
    await expect(
      executeClientMcpTool(service, {
        ...tool,
        operationId,
        assistantMessageId: 'client-assistant',
        toolMessageId: 'client-tool',
        toolCallId: tool.id,
      }),
    ).rejects.toThrow();
    expect(probes.execute).not.toHaveBeenCalled();
    expect(await service.invocations.clientSteps('client-topic')).toEqual([]);
  });
  it('anchors the original tool and model, fences duplicate queue deliveries, and commits independently of a renderer', async () => {
    const { operationId } = await register();
    const identity = {
      ...tool,
      apiName: tool.apiName,
      operationId,
      assistantMessageId: 'client-assistant',
      toolMessageId: 'client-tool',
      toolCallId: tool.id,
    };
    await Promise.all(Array.from({ length: 8 }, () => executeClientMcpTool(service, identity)));
    expect(probes.execute).toHaveBeenCalledOnce();
    expect((await messages.findById('client-tool'))?.content).toBe('saved-once');
    expect((await service.operations.findById(operationId))?.model).toBe('original-model');
    expect(service.runtime?.tryResumeParentFromAsyncTool).not.toHaveBeenCalled();
  });
  it('does not let a different tab resume before results, then claims one continuation after the old client lease expires', async () => {
    const { operationId } = await register();
    await db
      .update(agentOperations)
      .set({
        metadata: {
          ...(await service.operations.findById(operationId))!.metadata,
          clientMcpStep: {
            assistantMessageId: 'client-assistant',
            toolMessageIds: ['client-tool'],
            owner: randomUUID(),
            deadline: Date.now() + 120_000,
            leaseUntil: 0,
          },
        },
      })
      .where(eq(agentOperations.id, operationId));
    expect(await service.invocations.leaseClientStep(operationId, randomUUID())).toBeUndefined();
    await messages.updateToolMessage('client-tool', { content: 'actual remote result' });
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.invocations.leaseClientStep(operationId, randomUUID()),
      ),
    );
    const claims = attempts.filter(Boolean);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      model: 'original-model',
      provider: 'original-provider',
      toolMessageId: 'client-tool',
    });
  });
  it('keeps producer ownership in the durable invocation tuple without requiring Redis or allowing an expired process to replay', async () => {
    const { operationId } = await register();
    const base = {
      userId,
      operationId,
      assistantMessageId: 'client-assistant',
      toolCallId: 'call_1',
    };
    expect(
      await service.invocations.claimProducer(
        base,
        'process-1',
        'private-hash',
        Date.now() + 60_000,
      ),
    ).toBe(true);
    expect(
      await service.invocations.claimProducer(
        base,
        'process-1',
        'private-hash',
        Date.now() + 60_000,
      ),
    ).toBe(true);
    const rebuilt = new McpElicitationService(db, userId);
    expect(
      await rebuilt.invocations.claimProducer(
        base,
        'process-2',
        'private-hash',
        Date.now() + 60_000,
      ),
    ).toBe(false);
    expect(
      await rebuilt.invocations.claimProducer(
        base,
        'process-1',
        'changed-credential-hash',
        Date.now() + 60_000,
      ),
    ).toBe(false);
    expect(
      await rebuilt.invocations.claimProducer(
        { ...base, assistantMessageId: 'second-assistant' },
        'process-2',
        'private-hash',
        Date.now() + 60_000,
      ),
    ).toBe(true);
    expect(
      await new McpElicitationService(db, 'other-user').invocations.claimProducer(
        base,
        'process-2',
        'private-hash',
        Date.now() + 60_000,
      ),
    ).toBe(false);
  });

  it('does not permit another user to claim the client anchor or tool identity', async () => {
    const { operationId } = await register();
    const other = new McpElicitationService(db, 'another-user');
    expect(await other.invocations.leaseClientStep(operationId, randomUUID())).toBeUndefined();
    await expect(
      other.assertIdentity({
        ...tool,
        operationId,
        assistantMessageId: 'client-assistant',
        toolCallId: tool.id,
      }),
    ).rejects.toThrow();
    expect(await other.invocations.clientSteps('client-topic')).toEqual([]);
  });
});
