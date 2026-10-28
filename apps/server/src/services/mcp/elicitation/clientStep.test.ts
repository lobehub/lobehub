// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { agentOperations, agents, topics, users } from '@/database/schemas';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';

import { getTestDB } from '../../../../../../packages/database/src/core/getTestDB';
import {
  cancelClientMcpStep,
  executeClientMcpTool,
  expireClientMcpStep,
  registerClientMcpStep,
} from './clientStep';
import { McpElicitationService } from './McpElicitationService';

const probes = vi.hoisted(() => ({ execute: vi.fn(), manifest: vi.fn(), schedule: vi.fn() }));
vi.mock('@/server/services/file/impls', () => ({ createFileServiceModule: () => ({}) }));
vi.mock('@/server/services/queue', () => ({
  QueueService: class {
    getImpl() {
      return {};
    }
    scheduleMessage = probes.schedule;
  },
}));
vi.mock('./resume', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveMcpInvocationManifest: probes.manifest,
}));
const db = await getTestDB();
const userId = 'mcp-client-step-test';
const messages = new MessageModel(db, userId);
const service = new McpElicitationService(db, userId, undefined, undefined, {
  executeTool: probes.execute,
  isOperationInterrupted: async () => false,
  getToolResultPolicy: async () => ({ canReadArchive: true }),
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('durable client MCP host without Agent Gateway', () => {
  it.each(['environment', 'manifest'] as const)(
    'preserves a 300s %s execution budget',
    async (source) => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      if (source === 'environment') vi.stubEnv('MCP_TOOL_TIMEOUT', '300000');
      else
        probes.manifest.mockResolvedValue({
          identifier: 'fixture',
          api: [{ name: 'form', defaultTimeoutMs: 300000 }],
          mcpParams: { type: 'http', url: 'https://example.com' },
        });
      const { operationId, deadline } = await register();
      expect(deadline).toBe(now + 300000);
      await executeClientMcpTool(service, {
        ...tool,
        operationId,
        assistantMessageId: 'client-assistant',
        toolMessageId: 'client-tool',
        toolCallId: tool.id,
      });
      expect(probes.execute.mock.calls[0][1].executionTimeoutMs).toBe(300000);
    },
  );
  it('preserves the configured native stdio host default', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    probes.manifest.mockResolvedValue({
      identifier: 'fixture',
      mcpParams: { type: 'stdio', command: 'fixture' },
    });
    const first = await registerClientMcpStep(service, {
      assistantMessageId: 'client-assistant',
      toolMessageIds: ['client-tool'],
      owner: randomUUID(),
      localHostTimeoutMs: 300000,
    });
    expect(first.deadline).toBe(now + 300000);
    expect(first.deadlines).toEqual({ 'client-tool': now + 300000 });
  });
  it('keeps each MCP budget separate in a mixed-duration batch and ignores native hints for HTTP', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const long = { ...tool, id: 'long-call', arguments: JSON.stringify({ timeout: 300000 }) };
    await messages.update('client-assistant', { tools: [tool, long] });
    await messages.create(
      {
        role: 'tool',
        content: '',
        agentId: 'client-agent',
        topicId: 'client-topic',
        parentId: 'client-assistant',
        plugin: long,
        tool_call_id: long.id,
      },
      'long-mcp',
    );
    const anchor = await registerClientMcpStep(service, {
      assistantMessageId: 'client-assistant',
      toolMessageIds: ['client-tool', 'long-mcp'],
      owner: randomUUID(),
      localHostTimeoutMs: 900000,
    });
    expect(anchor.deadlines).toEqual({ 'client-tool': now + 60000, 'long-mcp': now + 300000 });
    clock.mockReturnValue(now + 61000);
    await executeClientMcpTool(service, {
      ...tool,
      operationId: anchor.operationId,
      assistantMessageId: 'client-assistant',
      toolMessageId: 'client-tool',
      toolCallId: tool.id,
    });
    expect(probes.execute).not.toHaveBeenCalled();
    expect((await messages.findMessagePlugin('client-tool'))?.error).toMatchObject({
      code: 'MCP_CLIENT_TOOL_FAILED',
    });
    await executeClientMcpTool(service, {
      ...long,
      operationId: anchor.operationId,
      assistantMessageId: 'client-assistant',
      toolMessageId: 'long-mcp',
      toolCallId: long.id,
    });
    expect(probes.execute).toHaveBeenCalledOnce();
    expect(probes.execute.mock.calls[0][1].executionTimeoutMs).toBe(239000);
  });
  it('retains a wire execution lease after its renderer owner disconnects', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const { operationId } = await register();
    await service.invocations.claimClientWire(operationId, 'client-tool', now + 240000);
    clock.mockReturnValue(now + 181000);
    await expireClientMcpStep(service, operationId);
    expect((await messages.findById('client-tool'))?.content).toBe('');
    clock.mockReturnValue(now + 241000);
    await expireClientMcpStep(service, operationId);
    expect((await messages.findMessagePlugin('client-tool'))?.error?.type).toBe(
      'MCP_CLIENT_TOOL_TIMEOUT',
    );
  });
  it.each(['expire', 'cancel'] as const)(
    '%s owns only MCP rows, while cold parent still waits for a long builtin sibling',
    async (action) => {
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      const builtin = { ...tool, id: 'builtin-2', type: 'builtin' as const, identifier: 'other' };
      await messages.update('client-assistant', { tools: [tool, builtin] });
      await messages.create(
        {
          role: 'tool',
          content: '',
          agentId: 'client-agent',
          topicId: 'client-topic',
          parentId: 'client-assistant',
          plugin: builtin,
          tool_call_id: builtin.id,
        },
        'long-builtin',
      );
      const owner = randomUUID();
      const { operationId } = await registerClientMcpStep(service, {
        assistantMessageId: 'client-assistant',
        toolMessageIds: ['client-tool', 'long-builtin'],
        owner,
      });
      if (action === 'expire')
        await messages.updateToolMessage('client-tool', { content: 'actual MCP result' });
      clock.mockReturnValue(now + 181000);
      if (action === 'expire') await expireClientMcpStep(service, operationId);
      else await cancelClientMcpStep(service, operationId, owner);
      expect((await messages.findById('long-builtin'))?.content).toBe('');
      expect((await messages.findMessagePlugin('long-builtin'))?.error).toBeFalsy();
      if (action === 'expire')
        expect((await messages.findById('client-tool'))?.content).toBe('actual MCP result');
      else
        expect((await messages.findMessagePlugin('client-tool'))?.error?.type).toBe(
          'MCP_CLIENT_TOOL_CANCELLED',
        );
      if (action === 'expire') {
        expect(
          await service.invocations.leaseClientStep(operationId, randomUUID()),
        ).toBeUndefined();
        await messages.updateToolMessage('long-builtin', { content: 'actual long builtin result' });
        const claims = await Promise.all(
          Array.from({ length: 4 }, () =>
            service.invocations.leaseClientStep(operationId, randomUUID()),
          ),
        );
        expect(claims.filter(Boolean)).toHaveLength(1);
      }
    },
  );
  it('does not publish unknown expiry over a live client heartbeat, but explicit stop still wins', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const owner = randomUUID();
    const { operationId } = await register();
    const op = (await service.operations.findById(operationId))!;
    await db
      .update(agentOperations)
      .set({
        metadata: {
          ...op.metadata,
          clientMcpStep: { ...op.metadata!.clientMcpStep, owner, leaseUntil: now + 240000 },
        },
      })
      .where(eq(agentOperations.id, operationId));
    clock.mockReturnValue(now + 181000);
    await expireClientMcpStep(service, operationId);
    expect((await messages.findById('client-tool'))?.content).toBe('');
    await cancelClientMcpStep(service, operationId, owner);
    expect((await messages.findMessagePlugin('client-tool'))?.error?.type).toBe(
      'MCP_CLIENT_TOOL_CANCELLED',
    );
  });
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

it.each([80000, 32])(
  'finalizes a full durable HTTP result with configured window %s before its renderer can disappear',
  async (limit) => {
    const { operationId } = await registerClientMcpStep(service, {
      assistantMessageId: 'client-assistant',
      toolMessageIds: ['client-tool'],
      owner: randomUUID(),
      toolResultMaxLength: limit,
    });
    const full = 'first line\n' + 'long tool result\n'.repeat(3000) + 'tail:client-receipt';
    probes.execute.mockImplementationOnce(async (_tool, context) => ({
      content: context.skipResultTruncation ? full : full.slice(0, 25000),
      success: true,
      executionTime: 1,
    }));
    await executeClientMcpTool(service, {
      ...tool,
      operationId,
      assistantMessageId: 'client-assistant',
      toolMessageId: 'client-tool',
      toolCallId: tool.id,
    });
    const row = await messages.findById('client-tool');
    if (limit > full.length) expect(row?.content).toBe(full);
    else {
      expect(row?.content).toContain('Full content archived');
      expect(row?.content).not.toContain('tail:client-receipt');
      const path = row!.content.match(/Path: (.+)/)![1];
      const persisted = await new AgentDocumentVfsService(db, userId).read(path, {
        agentId: 'client-agent',
        topicId: 'client-topic',
      });
      expect(persisted.content).toBe(full);
    }
    expect((await messages.findMessagePlugin('client-tool'))?.state?.mcpClientComplete).toBe(true);
  },
);

it('loads the recorded client archive policy for a later continuation even without a live client agent state', async () => {
  const { operationId } = await registerClientMcpStep(service, {
    assistantMessageId: 'client-assistant',
    toolMessageIds: ['client-tool'],
    owner: randomUUID(),
    toolResultMaxLength: 80000,
  });
  const { AgentRuntimeService } = await import('@/server/services/agentRuntime');
  // The renderer is gone and no live client AgentState remains.
  const runtime = AgentRuntimeService.prototype.getMcpElicitationRuntime.call({
    serverDB: db,
    userId,
    workspaceId: undefined,
    coordinator: { loadAgentState: async () => null },
  } as unknown as InstanceType<typeof AgentRuntimeService>);
  await expect(runtime.getToolResultPolicy(operationId)).resolves.toEqual({
    limit: 80000,
    canReadArchive: true,
  });
}, 30000);
