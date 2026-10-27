// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { agentOperations, agents, topics, userInstalledPlugins, users } from '@/database/schemas';

import { getTestDB } from '../../../../../../packages/database/src/core/getTestDB';
import { expireMcpElicitation } from './expire';
import { McpElicitationService } from './McpElicitationService';
import { executeMcpElicitationResume, scheduleMcpElicitationResume } from './queue';
import { resumeMcpElicitation } from './resume';

const probes = vi.hoisted(() => ({
  execute: vi.fn(),
  schedule: vi.fn(),
  control: vi.fn(async ({ result }) => ({ result, blocked: false })),
  resume: vi.fn(),
}));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: class {
    executeTool = probes.execute;
  },
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({ BuiltinToolsExecutor: class {} }));
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: class {
    controlCompletedToolResult = probes.control;
    tryResumeParentFromAsyncTool = probes.resume;
  },
}));

vi.mock('@/server/services/queue', () => ({
  QueueService: class {
    getImpl() {
      return {};
    }
    scheduleMessage = probes.schedule;
  },
}));

const db = await getTestDB();
const owner = 'mcp-test-owner';
const other = 'mcp-test-other';
const service = new McpElicitationService(db, owner);
const messageModel = new MessageModel(db, owner);
const identity = {
  apiName: 'form',
  assistantMessageId: 'mcp-assistant',
  identifier: 'fixture',
  operationId: 'mcp-op',
  toolCallId: 'mcp-tool',
};
const request = {
  mode: 'form' as const,
  message: 'Your label?',
  requestedSchema: {
    type: 'object' as const,
    properties: { label: { type: 'string' as const, minLength: 2 } },
    required: ['label'],
  },
};
const open = (overrides: Partial<Parameters<typeof service.open>[1]> = {}) =>
  service.open(identity, {
    deadline: Date.now() + 60_000,
    legacy: true,
    requests: { input: request },
    ...overrides,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  probes.execute.mockResolvedValue({ content: 'remote receipt', success: true, executionTime: 1 });
  probes.schedule.mockResolvedValue('queued');
  await db.delete(agentOperations).where(eq(agentOperations.id, identity.operationId));
  await db.delete(users).where(inArray(users.id, [owner, other]));
  await db.insert(users).values([{ id: owner }, { id: other }]);
  await db.insert(userInstalledPlugins).values({
    userId: owner,
    identifier: 'fixture',
    type: 'customPlugin',
    manifest: {
      identifier: 'fixture',
      api: [{ name: 'form', description: 'Form', parameters: { type: 'object', properties: {} } }],
      meta: {},
      version: '1',
    },
    customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
  });
  await db.insert(agents).values({ id: 'mcp-agent', userId: owner });
  await db.insert(topics).values({ id: 'mcp-topic', agentId: 'mcp-agent', userId: owner });
  await db.insert(agentOperations).values({
    id: identity.operationId,
    userId: owner,
    agentId: 'mcp-agent',
    topicId: 'mcp-topic',
    status: 'running',
  });
  await messageModel.create(
    {
      agentId: 'mcp-agent',
      topicId: 'mcp-topic',
      role: 'assistant',
      metadata: { operationId: identity.operationId },
      content: '',
      tools: [
        {
          apiName: identity.apiName,
          arguments: '{}',
          id: identity.toolCallId,
          identifier: identity.identifier,
          type: 'mcp',
        },
      ],
    },
    identity.assistantMessageId,
  );
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, [owner, other]));
});

describe('durable MCP elicitation', () => {
  it('binds a persisted form to its original tool and recovers it in a new service instance', async () => {
    const pending = await open();
    const restored = await new McpElicitationService(db, owner).loadContinuation(
      pending.toolMessageId,
    );
    expect(restored.identity).toMatchObject(identity);
    expect(restored.pending.requests).toEqual({ input: request });
    expect(pending.item.source).toBe('mcp');
  });
  it('does not expose or resolve another user or workspace request', async () => {
    const { item } = await open();
    await expect(new McpElicitationService(db, other).get(item.id)).rejects.toThrow('not found');
    await expect(
      new McpElicitationService(db, owner, 'wrong-workspace').get(item.id),
    ).rejects.toThrow('not found');
    await expect(
      new McpElicitationService(db, other).open(identity, {
        deadline: Date.now() + 10_000,
        legacy: true,
        requests: { input: request },
      }),
    ).rejects.toThrow('conversation');
  });
  it('keeps the first answer in the private outbox and makes exact retries idempotent', async () => {
    const { item, toolMessageId } = await open();
    const requestId = randomUUID();
    const responses = { input: { action: 'accept' as const, content: { label: 'first' } } };
    await service.claim(item.id, requestId, responses);
    expect((await service.claim(item.id, requestId, responses)).prior?.action).toMatchObject({
      type: 'submit_custom',
    });
    await expect(
      service.claim(item.id, requestId, { input: { action: 'decline' } }),
    ).rejects.toThrow('different response');
    expect((await messageModel.findById(toolMessageId))?.content).toBe('');
    expect(
      JSON.stringify((await messageModel.findMessagePlugin(toolMessageId))?.state),
    ).not.toContain('first');
  });
  it('permits only one concurrent decision and rejects invalid form content', async () => {
    const { item } = await open();
    await expect(
      service.claim(item.id, randomUUID(), {
        input: { action: 'accept', content: { label: 'x' } },
      }),
    ).rejects.toThrow();
    const attempts = await Promise.allSettled(
      ['accept', 'decline'].map((action) =>
        service.claim(item.id, randomUUID(), {
          input: {
            action: action as 'accept' | 'decline',
            ...(action === 'accept' && { content: { label: 'chosen' } }),
          },
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
  });
  it('rejects stale-round submissions while preserving a newer request', async () => {
    const first = await open();
    const second = await open({ requests: { input: { ...request, message: 'Second round' } } });
    await expect(
      service.claim(first.item.id, randomUUID(), { input: { action: 'cancel' } }),
    ).rejects.toThrow('newer round');
    expect((await service.loadContinuation(second.toolMessageId)).pending.batchId).toBe(
      second.state.batchId,
    );
  });
  it('answers a live legacy producer from a persisted resolution after reconnect', async () => {
    const waiting = service
      .createLegacyHost(identity, Date.now() + 10_000)
      .request(request, { signal: AbortSignal.timeout(10_000) });
    let pending;
    for (let i = 0; i < 50; i++) {
      const plugins = await messageModel.listMessagePluginsByTopic('mcp-topic');
      const source = plugins.find((plugin) => plugin.intervention?.batchId);
      if (source) {
        pending = (
          await service.interventions.findBatch(identity.operationId, source.intervention!.batchId!)
        ).interventions[0];
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(pending).toBeDefined();
    await new McpElicitationService(db, owner).claim(pending!.id, randomUUID(), {
      input: { action: 'cancel' },
    });
    await expect(waiting).resolves.toEqual({ action: 'cancel' });
    expect((await service.get(pending!.id)).status).toBe('resolved');
  });
  it('queues only outbox identity and resumes after the submitting process is gone', async () => {
    const checkpoint = {
      inputRequired: {
        resultType: 'input_required' as const,
        inputRequests: { input: { method: 'elicitation/create' as const, params: request } },
        requestState: 'opaque:do-not-disclose',
      },
      round: 1,
    };
    const { item, toolMessageId } = await open({ legacy: false, checkpoint });
    const resolutionRequestId = randomUUID();
    const responses = {
      input: { action: 'accept' as const, content: { label: 'private-answer' } },
    };
    await service.claim(item.id, resolutionRequestId, responses);
    await scheduleMcpElicitationResume(service, item.id, resolutionRequestId);
    const scheduled = probes.schedule.mock.calls.at(-1)![0];
    expect(JSON.stringify(scheduled.payload)).not.toContain('private-answer');
    expect(scheduled.endpoint).toContain('mcp-elicitation-resume');
    await executeMcpElicitationResume(
      new McpElicitationService(db, owner),
      item.id,
      resolutionRequestId,
    );
    expect(probes.execute).toHaveBeenCalledOnce();
    expect(probes.execute.mock.calls[0][1].mcpContinuation).toEqual({
      ...checkpoint,
      inputResponses: responses,
    });
    expect((await messageModel.findById(toolMessageId))?.content).toBe('remote receipt');
    expect(probes.control).toHaveBeenCalledBefore(probes.resume);
    await resumeMcpElicitation(service, { itemId: item.id, resolutionRequestId, responses });
    expect(probes.execute).toHaveBeenCalledOnce();
  });
  it('expires a parked tool with an error receipt and resumes its parent without executing MCP', async () => {
    const { item, toolMessageId } = await open({ deadline: Date.now() - 10, legacy: false });
    await expireMcpElicitation(service, item.id);
    expect((await messageModel.findById(toolMessageId))?.content).toContain('timed out');
    expect(probes.execute).not.toHaveBeenCalled();
    expect(probes.resume).toHaveBeenCalledOnce();
    await expireMcpElicitation(service, item.id);
    expect(probes.resume).toHaveBeenCalledOnce();
  });
  it('clears an orphaned form when expiry scheduling fails', async () => {
    probes.schedule.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(open({ legacy: false })).rejects.toThrow('queue unavailable');
    const [plugin] = await messageModel.listMessagePluginsByTopic('mcp-topic');
    expect(plugin.state?.mcpElicitation).toBeNull();
    expect(plugin.intervention?.status).toBe('none');
  });
  it('rejects a different operation in the same user and conversation', async () => {
    const operationId = 'mcp-other-op';
    await db.delete(agentOperations).where(eq(agentOperations.id, operationId));
    await db
      .insert(agentOperations)
      .values({ id: operationId, userId: owner, topicId: 'mcp-topic', status: 'running' });
    await expect(
      service.open(
        { ...identity, operationId },
        { legacy: true, deadline: Date.now() + 1000, requests: { input: request } },
      ),
    ).rejects.toThrow('conversation');
    await db.delete(agentOperations).where(eq(agentOperations.id, operationId));
  });
  it('retains the claimed answer when enqueue fails and recovers it on a subsequent read', async () => {
    const checkpoint = {
      inputRequired: {
        resultType: 'input_required' as const,
        inputRequests: { input: { method: 'elicitation/create' as const, params: request } },
      },
      round: 1,
    };
    const { item } = await open({ legacy: false, checkpoint });
    const resolutionRequestId = randomUUID();
    await service.claim(item.id, resolutionRequestId, {
      input: { action: 'accept', content: { label: 'retained' } },
    });
    probes.schedule.mockRejectedValueOnce(new Error('queue offline'));
    await expect(
      scheduleMcpElicitationResume(service, item.id, resolutionRequestId),
    ).rejects.toThrow('queue offline');
    const restored = new McpElicitationService(db, owner);
    await scheduleMcpElicitationResume(restored, item.id, resolutionRequestId);
    await executeMcpElicitationResume(restored, item.id, resolutionRequestId);
    expect(probes.execute.mock.calls[0][1].mcpContinuation.inputResponses.input.content.label).toBe(
      'retained',
    );
    expect(probes.execute).toHaveBeenCalledOnce();
  });
});
