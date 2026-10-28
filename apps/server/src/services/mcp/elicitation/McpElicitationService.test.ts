// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';

import { MCP_CONTINUATION_CONTROL } from '@lobechat/mcp-elicitation/types';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from '@/database/models/agentIntervention/utils';
import { McpInvocationModel } from '@/database/models/mcpInvocation';
import { MessageModel } from '@/database/models/message';
import {
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
  agents,
  topics,
  userInstalledPlugins,
  users,
} from '@/database/schemas';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';

import { getTestDB } from '../../../../../../packages/database/src/core/getTestDB';
import {
  allPendingToolsFulfilled,
  type AsyncToolDeps,
  resolveAsyncToolOnComplete,
} from '../../agentRuntime/AgentRuntimeService/asyncTool';
import { LocalQueueServiceImpl } from '../../queue/impls/local';
import { mcpConnectionBinding } from './binding';
import { expireMcpElicitation } from './expire';
import { McpElicitationService } from './McpElicitationService';
import {
  executeMcpElicitationResume as executeSavedMcpElicitationResume,
  recoverMcpElicitationResume,
  scheduleMcpElicitationResume,
} from './queue';
import { recoverPersistedMcpWork } from './recoveryWorker';
import { resumeMcpElicitation as resumeSavedMcpElicitation } from './resume';

const probes = vi.hoisted(() => ({
  execute: vi.fn(),
  interrupted: vi.fn().mockResolvedValue(false),
  policy: vi.fn().mockResolvedValue({ canReadArchive: false, limit: 25000 }),
  schedule: vi.fn(),
  control: vi.fn(async ({ result }) => ({ result, blocked: false, cancelled: false })),
  resume: vi.fn(),
  queueImpl: undefined as unknown,
  localCallback: vi.fn(),
}));
// Archives in this suite are database documents; no object-storage I/O is used.
vi.mock('@/server/services/file/impls', () => ({ createFileServiceModule: () => ({}) }));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: class {
    executeTool = probes.execute;
  },
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({ BuiltinToolsExecutor: class {} }));
vi.mock('./localCallback', () => ({ postLocalMcpCallback: probes.localCallback }));
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: class {
    constructor(
      private db: typeof db,
      private userId: string,
      private options: { workspaceId?: string },
    ) {}
    getMcpElicitationRuntime = () => testRuntime;
    createMcpElicitationService = () =>
      new McpElicitationService(
        this.db,
        this.userId,
        this.options.workspaceId,
        undefined,
        testRuntime,
      );
    controlCompletedToolResult = probes.control;
    tryResumeParentFromAsyncTool = probes.resume;
  },
}));

vi.mock('@/server/services/queue', () => ({
  QueueService: class {
    getImpl() {
      return probes.queueImpl ?? {};
    }
    scheduleMessage = probes.schedule;
  },
}));

const testRuntime = {
  executeTool: probes.execute,
  isOperationInterrupted: probes.interrupted,
  getToolResultPolicy: probes.policy,
  controlCompletedToolResult: probes.control,
  tryResumeParentFromAsyncTool: probes.resume,
};
const executeMcpElicitationResume = (
  ...args: Parameters<typeof executeSavedMcpElicitationResume>
) => executeSavedMcpElicitationResume(args[0], args[1], args[2], testRuntime);
const resumeMcpElicitation = (...args: Parameters<typeof resumeSavedMcpElicitation>) =>
  resumeSavedMcpElicitation(args[0], args[1], testRuntime);

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
  vi.stubEnv('KEY_VAULTS_SECRET', 'fixture-private-binding-key');
  vi.clearAllMocks();
  probes.queueImpl = undefined;
  probes.execute.mockResolvedValue({ content: 'remote receipt', success: true, executionTime: 1 });
  probes.schedule.mockResolvedValue('queued');
  await db.delete(agentOperations).where(inArray(agentOperations.userId, [owner, other]));
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

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await db.delete(agentOperations).where(inArray(agentOperations.userId, [owner, other]));
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
    await expireMcpElicitation(service, item.id, {
      controlCompletedToolResult: probes.control,
      tryResumeParentFromAsyncTool: probes.resume,
    });
    expect((await messageModel.findById(toolMessageId))?.content).toContain('timed out');
    expect(probes.execute).not.toHaveBeenCalled();
    expect(probes.resume).toHaveBeenCalledOnce();
    await expireMcpElicitation(service, item.id, {
      controlCompletedToolResult: probes.control,
      tryResumeParentFromAsyncTool: probes.resume,
    });
    expect(probes.resume).toHaveBeenCalledOnce();
  });
  it('keeps a long-running continuation fenced beyond 120s and publishes its actual result', async () => {
    const pending = await open({
      legacy: false,
      deadline: Date.now() + 800_000,
      checkpoint: {
        round: 1,
        inputRequired: {
          resultType: 'input_required',
          requestState: { cursor: 'next' },
          inputRequests: {
            input: { method: 'elicitation/create', params: request },
          },
        },
      },
    });
    const rid = randomUUID();
    await service.claim(pending.item.id, rid, {
      input: { action: 'accept', content: { label: 'long' } },
    });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    probes.execute.mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { content: 'actual remote mutation receipt', success: true, executionTime: 121_000 };
    });
    const first = executeMcpElicitationResume(service, pending.item.id, rid);
    await started;
    const now = Date.now();
    const execution = await service.invocations.execution(pending.item.id);
    expect(execution?.leaseExpiresAt?.getTime()).toBeGreaterThan(now + 800_000);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 121_000);
    try {
      await executeMcpElicitationResume(new McpElicitationService(db, owner), pending.item.id, rid);
      expect(probes.execute).toHaveBeenCalledOnce();
      expect(probes.control).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      release();
    }
    await first;
    expect((await messageModel.findById(pending.toolMessageId))?.content).toBe(
      'actual remote mutation receipt',
    );
    expect(probes.resume).toHaveBeenCalledOnce();
  });

  it('re-arms an expiry arriving 400ms before the deadline instead of acknowledging away the timeout', async () => {
    const deadline = Date.now() + 10_400;
    const { item, toolMessageId } = await open({ deadline, legacy: false });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline - 400);
    try {
      await expireMcpElicitation(service, item.id, {
        controlCompletedToolResult: probes.control,
        tryResumeParentFromAsyncTool: probes.resume,
      });
      expect(probes.schedule).toHaveBeenCalledTimes(2);
      expect(probes.schedule.mock.calls[1][0].delay).toBeGreaterThanOrEqual(400);
      expect(probes.schedule.mock.calls[1][0].deduplicationId).not.toBe(
        probes.schedule.mock.calls[0][0].deduplicationId,
      );
      expect((await messageModel.findById(toolMessageId))?.content).toBe('');
      expect(probes.resume).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it('does not overwrite an executing resolution when its form deadline expires', async () => {
    const { item, toolMessageId } = await open({ legacy: false });
    const resolutionRequestId = randomUUID();
    await service.claim(item.id, resolutionRequestId, {
      input: { action: 'accept', content: { label: 'chosen' } },
    });
    const execution = await service.interventions.claimCustomExecution({
      resolutionRequestId,
      inputHash: 'a'.repeat(64),
      leaseDurationMs: 120_000,
    });
    expect(execution.outcome).toBe('applied');
    await db
      .update(agentInterventions)
      .set({ deadline: new Date(Date.now() - 10) })
      .where(eq(agentInterventions.id, item.id));
    await expireMcpElicitation(service, item.id, {
      controlCompletedToolResult: probes.control,
      tryResumeParentFromAsyncTool: probes.resume,
    });
    expect((await messageModel.findById(toolMessageId))?.content).toBe('');
    expect(probes.control).not.toHaveBeenCalled();
    expect(probes.resume).not.toHaveBeenCalled();
    expect((await service.get(item.id)).status).toBe('resolving');
  });
  it('waits for a future dispatch fence after the execution lease expired, without one-second expiry spin', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const checkpoint = {
        inputRequired: { resultType: 'input_required' as const, requestState: 'private-state' },
        round: 1,
      };
      const { item, toolMessageId } = await open({ legacy: false, checkpoint });
      const resolutionRequestId = randomUUID();
      await service.claim(item.id, resolutionRequestId, {
        input: { action: 'accept', content: { label: 'chosen' } },
      });
      const inputHash = createHash('sha256')
        .update(
          canonicalJson({
            itemId: item.id,
            responses: { input: { action: 'accept', content: { label: 'chosen' } } },
          }),
        )
        .digest('hex');
      expect(
        (
          await service.interventions.claimCustomExecution({
            resolutionRequestId,
            inputHash,
            leaseDurationMs: 1000,
          })
        ).outcome,
      ).toBe('applied');
      await db
        .update(agentInterventionResolutions)
        .set({ customExecutionLeaseExpiresAt: new Date(now - 1000) })
        .where(eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId));
      await db
        .update(agentInterventions)
        .set({ deadline: new Date(now - 10) })
        .where(eq(agentInterventions.id, item.id));
      clock.mockReturnValue(now + 61000);
      const token = await service.invocations.claimDispatch(item.operationId, resolutionRequestId);
      expect(token).toBeTruthy();
      await service.invocations.acknowledgeDispatch(
        item.operationId,
        resolutionRequestId,
        token!,
        'delivered',
      );
      probes.schedule.mockClear();
      for (let index = 0; index < 3; index++) {
        await expireMcpElicitation(service, item.id, testRuntime);
        const callback = probes.schedule.mock.calls.at(-1)?.[0];
        expect(callback.delay).toBeGreaterThanOrEqual(15000);
        clock.mockReturnValue(Date.now() + callback.delay);
      }
      expect(
        probes.schedule.mock.calls.filter(([entry]) =>
          entry.endpoint.endsWith('mcp-elicitation-resume'),
        ),
      ).toHaveLength(1);
      expect((await messageModel.findById(toolMessageId))?.content).toBe('');
      expect(probes.execute).not.toHaveBeenCalled();
      await executeSavedMcpElicitationResume(service, item.id, resolutionRequestId, testRuntime);
      expect((await messageModel.findById(toolMessageId))?.content).toContain('outcome is unknown');
      expect(probes.execute).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it('does not starve current work behind 32 obsolete intervention rounds', async () => {
    const pending = await open({ legacy: false });
    const [original] = await db
      .select()
      .from(agentInterventions)
      .where(eq(agentInterventions.id, pending.item.id));
    await db.insert(agentInterventions).values(
      Array.from({ length: 32 }, (_, index) => ({
        ...original,
        id: randomUUID(),
        batchId: randomUUID(),
        activityKey: `obsolete-${index}`,
        reviewTokenHash: createHash('sha256').update(`obsolete-${index}`).digest('hex'),
        resolutionId: null,
        deadline: new Date(Date.now() - 60000 - index * 1000),
      })),
    );
    await db
      .update(agentInterventions)
      .set({ deadline: new Date(Date.now() - 1) })
      .where(eq(agentInterventions.id, pending.item.id));
    const work = await McpInvocationModel.recoveryWork(db);
    expect(work.interactions.map((item) => item.itemId)).toContain(pending.item.id);
    expect(work.interactions).toHaveLength(1);
  });
  it('clears an orphaned form when expiry scheduling fails', async () => {
    probes.schedule.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(open({ legacy: false })).rejects.toThrow('queue unavailable');
    const [plugin] = await messageModel.listMessagePluginsByTopic('mcp-topic');
    expect(plugin.state?.mcpElicitation).toBeNull();
    expect(plugin.intervention?.status).toBe('none');
  });
  it('runs local expiry with the injected runtime and finishes the persisted tool once', async () => {
    const impl = new LocalQueueServiceImpl();
    probes.queueImpl = impl;
    probes.schedule.mockImplementationOnce((message) =>
      impl.scheduleMessage({ ...message, delay: 1 }),
    );
    const local = new McpElicitationService(db, owner, undefined, (store, itemId) =>
      expireMcpElicitation(store, itemId, {
        controlCompletedToolResult: probes.control,
        tryResumeParentFromAsyncTool: probes.resume,
      }),
    );
    const { toolMessageId } = await local.open(identity, {
      deadline: Date.now() - 10,
      legacy: false,
      requests: { input: request },
    });
    await vi.waitFor(async () => {
      expect((await messageModel.findById(toolMessageId))?.content).toContain('timed out');
      expect(probes.resume).toHaveBeenCalledOnce();
    });
    expect(probes.control).toHaveBeenCalledOnce();
    expect(probes.resume).toHaveBeenCalledOnce();
    expect(probes.execute).not.toHaveBeenCalled();
  });
  it('keeps tools-only routes light and schedules a signed HTTP expiry callback in local mode', async () => {
    const impl = new LocalQueueServiceImpl();
    const callback = vi.spyOn(impl, 'setExecutionCallback');
    probes.queueImpl = impl;
    const pending = await open({ legacy: false });
    await callback.mock.calls[0][0](identity.operationId, 0, undefined);
    expect(probes.localCallback).toHaveBeenCalledWith(
      expect.stringContaining('/mcp-elicitation-expire'),
      expect.objectContaining({ itemId: pending.item.id, userId: owner }),
    );
  });
  it('recovers a persisted due timeout after rebuilding the local worker, without a frontend or original timer', async () => {
    const pending = await open({ legacy: false });
    await db
      .update(agentInterventions)
      .set({ deadline: new Date(Date.now() - 10) })
      .where(eq(agentInterventions.id, pending.item.id));
    await recoverPersistedMcpWork(db);
    expect((await messageModel.findById(pending.toolMessageId))?.content).toContain('timed out');
    expect(probes.resume).toHaveBeenCalledOnce();
    expect(probes.execute).not.toHaveBeenCalled();
  });
  it('returns only a bounded public pending projection and never publishes recovery on repeated reads', async () => {
    const pending = await open({ legacy: false });
    await service.claim(pending.item.id, randomUUID(), {
      input: { action: 'accept', content: { label: 'private-answer' } },
    });
    const before = probes.schedule.mock.calls.length;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.invocations.listPending('mcp-topic')),
    );
    expect(probes.schedule).toHaveBeenCalledTimes(before);
    expect(results[0]).toMatchObject([{ id: pending.item.id, resolving: true }]);
    expect(JSON.stringify(results)).not.toMatch(
      /private-answer|requestState|connectionBinding|arguments/,
    );
    expect(await new McpElicitationService(db, other).invocations.listPending('mcp-topic')).toEqual(
      [],
    );
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
  it('retains the claimed answer when enqueue fails and recovers it from a durable wakeup', async () => {
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
    await recoverMcpElicitationResume(restored, item.id);
    await executeMcpElicitationResume(restored, item.id, resolutionRequestId);
    expect(probes.execute.mock.calls[0][1].mcpContinuation.inputResponses.input.content.label).toBe(
      'retained',
    );
    expect(probes.execute).toHaveBeenCalledOnce();
  });
});

it('keeps two assistants in the same operation independent when the provider reuses its call id', async () => {
  const secondIdentity = { ...identity, assistantMessageId: 'mcp-assistant-two' };
  await messageModel.create(
    {
      agentId: 'mcp-agent',
      topicId: 'mcp-topic',
      role: 'assistant',
      content: '',
      metadata: { operationId: identity.operationId },
      tools: [
        {
          id: identity.toolCallId,
          apiName: 'form',
          identifier: 'fixture',
          arguments: '{}',
          type: 'mcp',
        },
      ],
    },
    secondIdentity.assistantMessageId,
  );
  const checkpoint = {
    inputRequired: {
      resultType: 'input_required' as const,
      inputRequests: { input: { method: 'elicitation/create' as const, params: request } },
      requestState: 'opaque',
    },
    round: 1,
  };
  const first = await open({ legacy: false, checkpoint });
  const second = await service.open(secondIdentity, {
    legacy: false,
    checkpoint,
    deadline: Date.now() + 10000,
    requests: { input: request },
  });
  expect(first.toolMessageId).not.toBe(second.toolMessageId);
  probes.execute.mockImplementation(async (_tool, ctx) => ({
    content: ctx.mcpContinuation.inputResponses.input.content.label,
    success: true,
    executionTime: 1,
  }));
  const work = [
    [first, 'first-receipt'],
    [second, 'second-receipt'],
  ] as const;
  for (const [pending, label] of work.toReversed()) {
    const rid = randomUUID();
    const responses = { input: { action: 'accept' as const, content: { label } } };
    await service.claim(pending.item.id, rid, responses);
    await executeMcpElicitationResume(new McpElicitationService(db, owner), pending.item.id, rid);
    await executeMcpElicitationResume(new McpElicitationService(db, owner), pending.item.id, rid);
    const deps = { serverDB: db, userId: owner, messageModel } as AsyncToolDeps;
    const tool = {
      id: identity.toolCallId,
      type: 'mcp',
      identifier: 'fixture',
      apiName: 'form',
      arguments: '{}',
    } as const;
    expect(
      await allPendingToolsFulfilled(deps, [tool], undefined, {
        messageIds: { [identity.toolCallId]: pending.toolMessageId },
      }),
    ).toBe(true);
    expect(
      await resolveAsyncToolOnComplete(deps, [tool], {
        messageIds: { [identity.toolCallId]: pending.toolMessageId },
      }),
    ).toBe('resume');
    if (pending === second) {
      expect(
        await allPendingToolsFulfilled(deps, [tool], undefined, {
          messageIds: { [identity.toolCallId]: first.toolMessageId },
        }),
      ).toBe(false);
    }
    // A provider ID alone cannot identify an MCP invocation.
    expect(await allPendingToolsFulfilled(deps, [tool])).toBe(false);
  }
  expect(probes.execute).toHaveBeenCalledTimes(2);
  expect((await messageModel.findById(first.toolMessageId))?.content).toBe('first-receipt');
  expect((await messageModel.findById(second.toolMessageId))?.content).toBe('second-receipt');
  expect((await messageModel.findById(second.toolMessageId))?.parentId).toBe(
    secondIdentity.assistantMessageId,
  );
});
it.each(['bearer', 'header', 'oauth-config'])(
  'refuses a changed %s credential before executing the saved answer',
  async (kind) => {
    const original = {
      type: 'http' as const,
      url: 'https://example.com/mcp',
      ...(kind === 'header'
        ? { headers: { Authorization: 'fixture-old' } }
        : {
            auth:
              kind === 'bearer'
                ? { type: 'bearer', token: 'fixture-old' }
                : {
                    type: 'oauth2',
                    accessToken: 'old',
                    refreshToken: 'r',
                    clientId: 'client',
                    serverMetadata: { issuer: 'https://issuer.example' },
                  },
          }),
    };
    const changed =
      kind === 'header'
        ? { ...original, headers: { Authorization: 'fixture-new' } }
        : {
            ...original,
            auth: {
              ...original.auth,
              ...(kind === 'bearer' ? { token: 'fixture-new' } : { clientId: 'different-client' }),
            },
          };
    await db
      .update(userInstalledPlugins)
      .set({ customParams: { mcp: changed } as any })
      .where(eq(userInstalledPlugins.identifier, 'fixture'));
    const checkpoint = {
      inputRequired: {
        resultType: 'input_required' as const,
        inputRequests: { input: { method: 'elicitation/create' as const, params: request } },
      },
      round: 1,
    };
    const pending = await open({
      legacy: false,
      checkpoint,
      connectionBinding: mcpConnectionBinding(original),
    });
    const rid = randomUUID();
    await service.claim(pending.item.id, rid, {
      input: { action: 'accept', content: { label: 'private' } },
    });
    await executeMcpElicitationResume(new McpElicitationService(db, owner), pending.item.id, rid);
    expect(probes.execute).not.toHaveBeenCalled();
    expect((await messageModel.findById(pending.toolMessageId))?.content).toContain(
      'connection changed',
    );
  },
);
it('persists and cancels a state-only wait without sending another tools/call', async () => {
  const { MCP_CONTINUATION_CONTROL } = await import('@lobechat/mcp-elicitation/types');
  const checkpoint = {
    inputRequired: { resultType: 'input_required' as const, requestState: 'external-pending' },
    round: 1,
  };
  const pending = await open({ legacy: false, checkpoint, requests: {} });
  const rid = randomUUID();
  await service.claim(pending.item.id, rid, { [MCP_CONTINUATION_CONTROL]: { action: 'cancel' } });
  await executeMcpElicitationResume(new McpElicitationService(db, owner), pending.item.id, rid);
  expect(probes.execute).not.toHaveBeenCalled();
  expect((await messageModel.findById(pending.toolMessageId))?.content).toContain('cancelled');
  expect(probes.resume).toHaveBeenCalledOnce();
});
it.each(['before-enqueue', 'lost-ack'])(
  'rebuilds the service after %s and executes real SDK tools/call only once',
  async (fault) => {
    const { startElicitationServers } =
      await import('@/libs/mcp/__tests__/fixtures/elicitationServers');
    const { MCPClient } = await import('@/libs/mcp/client');
    const server = await startElicitationServers();
    const connect = async () => {
      const c = new MCPClient({ type: 'http', name: 'fixture', url: server.url + '/modern' }, true);
      await c.initialize();
      return c;
    };
    const initial = await connect();
    try {
      const error = await initial.callTool('form', {}).catch((e) => e);
      await db
        .update(userInstalledPlugins)
        .set({ customParams: { mcp: { type: 'http', url: server.url + '/modern' } } })
        .where(eq(userInstalledPlugins.identifier, 'fixture'));
      const pending = await open({
        legacy: false,
        checkpoint: error.checkpoint,
        requests: { details: request },
      });
      const rid = randomUUID();
      await service.claim(pending.item.id, rid, {
        details: { action: 'accept', content: { label: 'retained' } },
      });
      let enqueued: any;
      probes.schedule.mockImplementationOnce(async (job) => {
        if (fault === 'lost-ack') enqueued = job;
        throw new Error('lost schedule ACK');
      });
      await expect(scheduleMcpElicitationResume(service, pending.item.id, rid)).rejects.toThrow(
        'ACK',
      );
      probes.execute.mockImplementation(async (_tool, ctx) => {
        const client = await connect();
        try {
          const result = await client.callTool('form', {}, { continuation: ctx.mcpContinuation });
          return { content: JSON.stringify(result.content), success: true, executionTime: 1 };
        } finally {
          await client.disconnect();
        }
      });
      const publishedBeforeRecovery = probes.schedule.mock.calls.length;
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 15_001);
      try {
        await Promise.all(
          Array.from({ length: 8 }, () =>
            recoverMcpElicitationResume(new McpElicitationService(db, owner), pending.item.id),
          ),
        );
      } finally {
        clock.mockRestore();
      }
      expect(probes.schedule).toHaveBeenCalledTimes(publishedBeforeRecovery + 1);
      const recovered = probes.schedule.mock.calls.at(-1)![0];
      expect(recovered.deduplicationId).toBe('mcp-resume-' + rid);
      if (enqueued) expect(enqueued.deduplicationId).toBe(recovered.deduplicationId);
      for (let delivery = 0; delivery < 2; delivery++)
        await executeMcpElicitationResume(
          new McpElicitationService(db, owner),
          pending.item.id,
          rid,
        );
      expect(probes.execute).toHaveBeenCalledOnce();
      const trace = await (await fetch(server.url + '/trace')).json();
      expect(trace.requests.filter((r: any) => r.method === 'tools/call')).toHaveLength(2);
      expect((await messageModel.findById(pending.toolMessageId))?.content).toContain(
        'saved:retained',
      );
    } finally {
      await initial.disconnect();
      await server.close();
    }
  },
);

it('authorizes a client-to-durable approval continuation only for its server-persisted exact source message', async () => {
  const source = await service.ensureToolMessage(identity);
  const replacement = { ...identity, operationId: 'mcp-replacement', toolMessageId: source };
  await db.insert(agentOperations).values({
    id: replacement.operationId,
    userId: owner,
    agentId: 'mcp-agent',
    topicId: 'mcp-topic',
    status: 'running',
  });
  await expect(service.assertIdentity(replacement)).rejects.toThrow('conversation');
  await service.operations.mergeMetadata(replacement.operationId, {
    mcpInvocationSources: [
      {
        assistantMessageId: identity.assistantMessageId,
        toolCallId: identity.toolCallId,
        toolMessageId: source,
      },
    ],
  });
  expect(await service.ensureToolMessage(replacement)).toBe(source);
  await expect(
    service.ensureToolMessage({ ...replacement, toolMessageId: 'wrong-row' }),
  ).rejects.toThrow('conversation');
});

it('settles a stopped queued continuation without sending tools/call', async () => {
  const { item, toolMessageId } = await open({
    legacy: false,
    checkpoint: {
      inputRequired: { resultType: 'input_required', requestState: 'saved' },
      round: 1,
    },
    requests: {},
  });
  const rid = randomUUID();
  await service.claim(item.id, rid, { [MCP_CONTINUATION_CONTROL]: { action: 'accept' } });
  probes.interrupted.mockResolvedValueOnce(true);
  await executeMcpElicitationResume(service, item.id, rid);
  expect(probes.execute).not.toHaveBeenCalled();
  expect((await messageModel.findById(toolMessageId))?.content).toContain('stopped');
});
it('redelivers a committed result after parent-resume failure without repeating the remote mutation', async () => {
  const { item, toolMessageId } = await open({
    legacy: false,
    checkpoint: {
      inputRequired: { resultType: 'input_required', requestState: 'saved' },
      round: 1,
    },
    requests: {},
  });
  const rid = randomUUID();
  await service.claim(item.id, rid, { [MCP_CONTINUATION_CONTROL]: { action: 'accept' } });
  probes.resume.mockRejectedValueOnce(new Error('temporary parent queue failure'));
  await expect(executeMcpElicitationResume(service, item.id, rid)).rejects.toThrow('parent queue');
  await executeMcpElicitationResume(new McpElicitationService(db, owner), item.id, rid);
  expect(probes.execute).toHaveBeenCalledOnce();
  expect((await messageModel.findById(toolMessageId))?.content).toBe('remote receipt');
  expect((await service.get(item.id)).status).toBe('resolved');
});

it('archives the complete long continuation result with the original configured window and a readable omitted tail', async () => {
  const { item, toolMessageId } = await open({
    legacy: false,
    checkpoint: {
      inputRequired: { resultType: 'input_required', requestState: 'saved' },
      round: 1,
    },
    requests: {},
  });
  const rid = randomUUID();
  await service.claim(item.id, rid, { [MCP_CONTINUATION_CONTROL]: { action: 'accept' } });
  const full = 'first line\n' + 'long tool result\n'.repeat(3000) + 'tail:remote-receipt';
  probes.execute.mockImplementationOnce(async (_tool, ctx) => ({
    content: ctx.skipResultTruncation ? full : full.slice(0, 25000),
    success: true,
    executionTime: 1,
  }));
  probes.policy.mockResolvedValueOnce({ canReadArchive: true, limit: 32 });
  await executeMcpElicitationResume(service, item.id, rid);
  const row = await messageModel.findById(toolMessageId);
  expect(row?.content).toContain('Full content archived');
  expect(row?.content).not.toContain('tail:remote-receipt');
  const path = row!.content.match(/Path: (.+)/)![1];
  const persisted = await new AgentDocumentVfsService(db, owner).read(path, {
    agentId: 'mcp-agent',
    topicId: 'mcp-topic',
  });
  expect(persisted.content).toBe(full);
});

it('retains a timed-out receipt and its recovery projection after parent dispatch fails, then recovers with a fresh service', async () => {
  const { item, toolMessageId } = await open({ deadline: Date.now() - 10, legacy: false });
  await db
    .update(agentOperations)
    .set({ status: 'waiting_for_async_tool' })
    .where(eq(agentOperations.id, identity.operationId));
  probes.resume.mockRejectedValueOnce(new Error('temporary parent Redis failure'));
  await expect(expireMcpElicitation(service, item.id, testRuntime)).rejects.toThrow(
    'Redis failure',
  );
  const receipt = (await messageModel.findById(toolMessageId))?.content;
  expect(receipt).toContain('timed out');
  const recoverable = await McpInvocationModel.recoveryQueries(db).interactions;
  expect(recoverable.map((row) => row.itemId)).toContain(item.id);
  const fresh = new McpElicitationService(db, owner);
  await recoverPersistedMcpWork(db);
  expect((await messageModel.findById(toolMessageId))?.content).toBe(receipt);
  expect((await messageModel.findMessagePlugin(toolMessageId))?.state?.mcpElicitation).toBeNull();
  expect((await messageModel.findMessagePlugin(toolMessageId))?.intervention?.status).toBe('none');
  await expireMcpElicitation(fresh, item.id, testRuntime);
  expect(probes.resume).toHaveBeenCalledTimes(2);
  expect(probes.execute).not.toHaveBeenCalled();
});
