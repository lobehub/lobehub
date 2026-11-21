import { ThreadStatus, ThreadType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CancelSubAgentRunDeps, SubAgentRunDeps } from '../subAgentRuns';
import { cancelSubAgentThreadRun, execAgentThreadRun } from '../subAgentRuns';

const callSubAgentPlugin = { apiName: 'callSubAgent', identifier: 'lobe-agent' };

const subAgentThread = (overrides: Record<string, unknown> = {}) => ({
  agentId: 'agent-1',
  id: 'thread-1',
  metadata: { operationId: 'sub-op-1', startedAt: '2026-11-07T00:00:00.000Z' },
  sourceMessageId: 'placeholder-1',
  status: ThreadStatus.Processing,
  topicId: 'topic-1',
  type: ThreadType.Isolation,
  ...overrides,
});

const params = { agentId: 'agent-1', threadId: 'thread-1', topicId: 'topic-1' };

describe('cancelSubAgentThreadRun', () => {
  let deps: CancelSubAgentRunDeps;
  let messageModel: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    messageModel = {
      claimBackgroundSubAgentDelivery: vi.fn(async (ids: string[]) => ids),
      findMessagePlugin: vi.fn(async (id: string) =>
        id === 'placeholder-1' ? callSubAgentPlugin : { ...callSubAgentPlugin, state: {} },
      ),
      listBackgroundSubAgentCalls: vi.fn().mockResolvedValue([]),
      releaseCancelSuppressedDelivery: vi.fn(async (ids: string[]) => ids),
    };
    deps = {
      agentOperationModel: { findById: vi.fn().mockResolvedValue({ status: 'running' }) } as any,
      interruptTask: vi.fn().mockResolvedValue({ success: true }),
      isOperationInterrupted: vi.fn().mockResolvedValue(true),
      messageModel: messageModel as any,
      stopWaitMs: 0,
      threadModel: { findById: vi.fn().mockResolvedValue(subAgentThread()) } as any,
    };
  });

  it('interrupts the running sub-agent of its thread', async () => {
    const result = await cancelSubAgentThreadRun(deps, params);

    expect(deps.interruptTask).toHaveBeenCalledWith({
      operationId: 'sub-op-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
    expect(result).toEqual({
      operationId: 'sub-op-1',
      status: 'cancelled',
      stopped: false,
      threadId: 'thread-1',
    });
  });

  it('reports the run stopped once its status leaves flight', async () => {
    vi.mocked(deps.agentOperationModel.findById)
      .mockResolvedValueOnce({ status: 'running' } as any)
      .mockResolvedValue({ status: 'interrupted' } as any);

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(result).toMatchObject({ status: 'cancelled', stopped: true });
  });

  it('hands the delivery back when the run ended on its own before the stop', async () => {
    messageModel.listBackgroundSubAgentCalls.mockResolvedValue([
      { id: 'bg-call-1', state: { background: true, status: 'pending', threadId: 'thread-1' } },
    ]);
    // A stop that finds the run already terminal acknowledges it without the mark.
    vi.mocked(deps.isOperationInterrupted).mockResolvedValue(false);

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(messageModel.releaseCancelSuppressedDelivery).toHaveBeenCalledWith(['bg-call-1']);
    expect(result.status).toBe('not_running');
  });

  it('marks a background run delivered so the stop does not wake the parent', async () => {
    messageModel.listBackgroundSubAgentCalls.mockResolvedValue([
      { id: 'bg-call-1', state: { background: true, status: 'pending', threadId: 'thread-1' } },
      { id: 'bg-call-2', state: { background: true, status: 'pending', threadId: 'thread-2' } },
    ]);

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(messageModel.listBackgroundSubAgentCalls).toHaveBeenCalledWith({
      scope: 'running',
      topicId: 'topic-1',
    });
    expect(messageModel.claimBackgroundSubAgentDelivery).toHaveBeenCalledWith(
      ['bg-call-1'],
      expect.any(String),
      { suppressedByCancel: true },
    );
    // The claim must land before the stop: the interrupted run's completion
    // delivers whatever is still unclaimed.
    expect(messageModel.claimBackgroundSubAgentDelivery.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.interruptTask).mock.invocationCallOrder[0],
    );
    expect(messageModel.releaseCancelSuppressedDelivery).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });

  it('hands the delivery back when the run finished before the stop landed', async () => {
    messageModel.listBackgroundSubAgentCalls.mockResolvedValue([
      { id: 'bg-call-1', state: { background: true, status: 'pending', threadId: 'thread-1' } },
    ]);
    messageModel.findMessagePlugin.mockImplementation(async (id: string) =>
      id === 'placeholder-1'
        ? callSubAgentPlugin
        : { ...callSubAgentPlugin, state: { background: true, status: 'completed' } },
    );

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(messageModel.releaseCancelSuppressedDelivery).toHaveBeenCalledWith(['bg-call-1']);
    expect(result.status).toBe('not_running');
  });

  it('reports a run that finished while the stop was waiting as not cancelled', async () => {
    // The interrupt mark landed after the run's last check, so it still saved a
    // completed answer while cancel waited for it to leave flight.
    messageModel.listBackgroundSubAgentCalls.mockResolvedValue([
      { id: 'bg-call-1', state: { background: true, status: 'pending', threadId: 'thread-1' } },
    ]);
    let status = 'pending';
    messageModel.findMessagePlugin.mockImplementation(async (id: string) =>
      id === 'placeholder-1'
        ? callSubAgentPlugin
        : { ...callSubAgentPlugin, state: { background: true, status } },
    );
    vi.mocked(deps.agentOperationModel.findById)
      .mockResolvedValueOnce({ status: 'running' } as any)
      .mockImplementation(async () => {
        status = 'completed';
        return { status: 'done' } as any;
      });
    deps.stopWaitMs = 1000;

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(messageModel.releaseCancelSuppressedDelivery).toHaveBeenCalledWith(['bg-call-1']);
    expect(result.status).toBe('not_running');
  });

  it('hands the delivery back when the stop is not confirmed', async () => {
    messageModel.listBackgroundSubAgentCalls.mockResolvedValue([
      { id: 'bg-call-1', state: { background: true, status: 'pending', threadId: 'thread-1' } },
    ]);
    vi.mocked(deps.interruptTask).mockResolvedValue({ success: false });

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(messageModel.releaseCancelSuppressedDelivery).toHaveBeenCalledWith(['bg-call-1']);
    expect(result).toMatchObject({ status: 'failed', threadId: 'thread-1' });
  });

  it('hands the delivery back when the stop throws', async () => {
    messageModel.listBackgroundSubAgentCalls.mockResolvedValue([
      { id: 'bg-call-1', state: { background: true, status: 'pending', threadId: 'thread-1' } },
    ]);
    vi.mocked(deps.interruptTask).mockRejectedValue(new Error('redis down'));

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(messageModel.releaseCancelSuppressedDelivery).toHaveBeenCalledWith(['bg-call-1']);
    expect(result).toMatchObject({ error: 'Error: redis down', status: 'failed' });
  });

  it('stops nothing when the sub-agent already finished', async () => {
    vi.mocked(deps.agentOperationModel.findById).mockResolvedValue({ status: 'done' } as any);

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(deps.interruptTask).not.toHaveBeenCalled();
    expect(messageModel.claimBackgroundSubAgentDelivery).not.toHaveBeenCalled();
    expect(result).toEqual({
      operationId: 'sub-op-1',
      status: 'not_running',
      threadId: 'thread-1',
    });
  });

  it.each([
    ['another topic', { topicId: 'topic-2' }],
    ['another agent', { agentId: 'agent-2' }],
    ['a non-isolation thread', { type: ThreadType.Continuation }],
  ])('refuses a thread from %s', async (_, overrides) => {
    vi.mocked(deps.threadModel.findById).mockResolvedValue(subAgentThread(overrides) as any);

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(deps.interruptTask).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('was not found in this conversation');
  });

  it('refuses a thread that callSubAgent did not start', async () => {
    messageModel.findMessagePlugin.mockResolvedValue({
      apiName: 'callAgent',
      identifier: 'lobe-agent-management',
    });

    const result = await cancelSubAgentThreadRun(deps, params);

    expect(deps.interruptTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.error).toContain('not a sub-agent started by callSubAgent');
  });
});

describe('continuing a sub-agent that is still stopping', () => {
  it('says the cancelled run is finishing its step instead of calling it busy', async () => {
    const isOperationInterrupted = vi.fn().mockResolvedValue(true);
    const deps = {
      agentOperationModel: { findById: vi.fn().mockResolvedValue({ status: 'running' }) },
      agentRuntimeService: { isOperationInterrupted },
      execAgent: vi.fn(),
      messageModel: { findMessagePlugin: vi.fn().mockResolvedValue(callSubAgentPlugin) },
      threadModel: { claimForRun: vi.fn(), findById: vi.fn().mockResolvedValue(subAgentThread()) },
      userId: 'user-1',
    } as unknown as SubAgentRunDeps;

    const result = await execAgentThreadRun(
      deps,
      {
        agentId: 'agent-1',
        instruction: 'Focus on the 2026 numbers instead',
        parentMessageId: 'placeholder-2',
        parentOperationId: '',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      { isSubAgent: true, logScope: 'execVirtualSubAgent', resumeParentOnComplete: true },
    );

    expect(isOperationInterrupted).toHaveBeenCalledWith('sub-op-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('was cancelled and is still finishing its current step');
    expect(deps.threadModel.claimForRun).not.toHaveBeenCalled();
    expect(deps.execAgent).not.toHaveBeenCalled();
  });
});
