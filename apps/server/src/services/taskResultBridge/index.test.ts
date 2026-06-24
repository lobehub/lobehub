// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';

import { TaskResultBridgeService } from './index';

// `MessageModel.create` is a class-field arrow (instance prop, not on the
// prototype) and `AiAgentService`'s constructor builds many sub-services — mock
// both modules so we observe the calls without standing up the real graph.
const { createMsg, execAgent } = vi.hoisted(() => ({ createMsg: vi.fn(), execAgent: vi.fn() }));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({ create: createMsg })),
}));

vi.mock('../aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ execAgent })),
}));

const TEST_USER = 'user-1';
const db = {} as any;

const ORIGIN = {
  agentId: 'agent-creator',
  messageId: 'msg-anchor',
  operationId: 'op-creator',
  toolCallId: 'tc-1',
  topicId: 'topic-origin',
};

const baseParams = {
  operationId: 'op-task',
  reason: 'done',
  taskId: 'task-1',
  taskIdentifier: 'T-1',
  topicId: 'topic-done',
};

describe('TaskResultBridgeService.deliver', () => {
  // Loosely typed: vi.spyOn's generic MockInstance isn't assignable from the
  // method-specific spy types (TaskModel.findById / TaskTopicModel.findByTopicId).
  let findById: any;
  let findByTopicId: any;

  beforeEach(() => {
    createMsg.mockReset().mockResolvedValue({ id: 'task-cb-task-1-topic-done' } as any);
    execAgent
      .mockReset()
      .mockResolvedValue({ operationId: 'op-new', topicId: 'topic-origin' } as any);
    findById = vi.spyOn(TaskModel.prototype, 'findById').mockResolvedValue({
      automationMode: null,
      context: { origin: ORIGIN },
      status: 'running',
    } as any);
    findByTopicId = vi.spyOn(TaskTopicModel.prototype, 'findByTopicId').mockResolvedValue({
      handoff: {
        keyFindings: ['a', 'b'],
        nextAction: 'ship it',
        summary: 'Fixed the null deref',
        title: 'Fix',
      },
    } as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it('appends a taskCallback card to the origin topic and runs the creator agent off history', async () => {
    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).toHaveBeenCalledTimes(1);
    const [params, id] = createMsg.mock.calls[0] as [any, string];
    expect(params).toMatchObject({
      agentId: 'agent-creator',
      parentId: 'msg-anchor',
      role: 'taskCallback',
      topicId: 'topic-origin',
    });
    expect(params.metadata.taskCallback).toMatchObject({
      identifier: 'T-1',
      reason: 'done',
      taskId: 'task-1',
      topicId: 'topic-done',
    });
    expect(params.content).toContain('Fixed the null deref');
    expect(params.content).toContain('ship it');
    // deterministic id keyed on (task, completed topic) for idempotency
    expect(id).toBe('task-cb-task-1-topic-done');

    expect(execAgent).toHaveBeenCalledTimes(1);
    expect(execAgent.mock.calls[0][0]).toMatchObject({
      agentId: 'agent-creator',
      appContext: { topicId: 'topic-origin' },
      parentMessageId: 'task-cb-task-1-topic-done',
      suppressUserMessage: true,
    });
  });

  it('skips tasks with no origin (e.g. API-created)', async () => {
    findById.mockResolvedValue({ context: {}, status: 'completed' } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).not.toHaveBeenCalled();
    expect(execAgent).not.toHaveBeenCalled();
  });

  it('is idempotent: a redelivered hook (duplicate PK) does not re-run the agent', async () => {
    createMsg.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }),
    );

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(execAgent).not.toHaveBeenCalled();
  });

  it('bridges a failed run with the error text and reason', async () => {
    findByTopicId.mockResolvedValue({ handoff: undefined } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver({
      ...baseParams,
      errorMessage: 'boom: provider 500',
      reason: 'error',
    });

    const [params] = createMsg.mock.calls[0] as [any, string];
    expect(params.metadata.taskCallback.reason).toBe('error');
    expect(params.content).toContain('boom: provider 500');
  });

  it('defers automation tasks until the task itself is terminal', async () => {
    findById.mockResolvedValue({
      automationMode: 'schedule',
      context: { origin: ORIGIN },
      status: 'running',
    } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).not.toHaveBeenCalled();
    expect(execAgent).not.toHaveBeenCalled();
  });

  // The bridge runs from onTopicComplete AFTER status transitions, so a
  // scheduled task that hit its cap is already `completed` when we read it —
  // the callback must NOT be dropped (the race that this fix closes).
  it('bridges an automation task once it has reached a terminal status', async () => {
    findById.mockResolvedValue({
      automationMode: 'schedule',
      context: { origin: ORIGIN },
      status: 'completed',
    } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).toHaveBeenCalledTimes(1);
    expect(execAgent).toHaveBeenCalledTimes(1);
  });

  it('falls back to lastAssistantContent when the handoff is not yet written (cloud race)', async () => {
    findByTopicId.mockResolvedValue({ handoff: undefined } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver({
      ...baseParams,
      lastAssistantContent: 'Raw final output from the run',
    });

    const [params] = createMsg.mock.calls[0] as [any, string];
    expect(params.content).toContain('Raw final output from the run');
  });
});
