import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type BackgroundSubAgentDeliveryDeps,
  deliverBackgroundSubAgentResults,
  wakeForBackgroundResults,
} from '../backgroundSubAgentDelivery';

const finished = (
  id: string,
  overrides: {
    sender?: { agentId?: string; name?: string };
    state?: object;
    threadId?: string | null;
  } = {},
) => ({
  agentId: 'agent-1',
  arguments: null,
  id,
  state: {
    background: true,
    result: `Answer of ${id}`,
    sender: overrides.sender ?? { agentId: 'agent-1', name: `Task ${id}` },
    status: 'completed',
    threadId: `thread-${id}`,
    ...overrides.state,
  },
  threadId: overrides.threadId ?? null,
});

const createDeps = (opts: {
  marker?: { operationId: string } | null;
  markerStatus?: string;
  pending?: ReturnType<typeof finished>[];
}) => {
  const deps = {
    agentOperationModel: {
      findById: vi.fn().mockResolvedValue(opts.markerStatus ? { status: opts.markerStatus } : null),
    },
    appendResultMessages: vi.fn().mockResolvedValue('leaf-msg'),
    messageModel: {
      claimBackgroundSubAgentDelivery: vi.fn(async (ids: string[]) => ids),
      listBackgroundSubAgentCalls: vi.fn().mockResolvedValue(opts.pending ?? []),
      releaseBackgroundSubAgentDelivery: vi.fn().mockResolvedValue(undefined),
    },
    queueWakeup: vi.fn().mockResolvedValue(undefined),
    topicModel: {
      findById: vi.fn().mockResolvedValue({
        agentId: 'agent-1',
        id: 'topic-1',
        metadata: { runningOperation: opts.marker ?? null },
      }),
    },
  };
  return deps as typeof deps & BackgroundSubAgentDeliveryDeps;
};

describe('deliverBackgroundSubAgentResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The answer lands as a message from the sub-agent, and the parent runs off
  // that history — no made-up user turn.
  it('lands each answer as a message from its sender, then wakes the parent once', async () => {
    const deps = createDeps({
      pending: [finished('a'), finished('b', { sender: { agentId: 'poet', name: 'Poet' } })],
    });

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

    expect(deps.appendResultMessages).toHaveBeenCalledWith({
      agentId: 'agent-1',
      results: [
        {
          callId: 'a',
          result: 'Answer of a',
          sender: { agentId: 'agent-1', name: 'Task a' },
          status: 'completed',
          threadId: 'thread-a',
        },
        {
          callId: 'b',
          result: 'Answer of b',
          sender: { agentId: 'poet', name: 'Poet' },
          status: 'completed',
          threadId: 'thread-b',
        },
      ],
      topicId: 'topic-1',
    });
    // Woken through the channel finished tasks and sub-topics share.
    expect(deps.queueWakeup).toHaveBeenCalledTimes(1);
    expect(deps.queueWakeup).toHaveBeenCalledWith({
      agentId: 'agent-1',
      callbackMessageId: 'leaf-msg',
      originTopicId: 'topic-1',
      receiptId: 'subagent-cb-a',
      resultCount: 2,
    });
  });

  it('waits while another run holds the topic', async () => {
    const deps = createDeps({
      marker: { operationId: 'user-op' },
      markerStatus: 'running',
      pending: [finished('a')],
    });

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

    expect(deps.messageModel.listBackgroundSubAgentCalls).not.toHaveBeenCalled();
    expect(deps.appendResultMessages).not.toHaveBeenCalled();
    expect(deps.queueWakeup).not.toHaveBeenCalled();
  });

  it('does not count the run that is settling right now as busy', async () => {
    const deps = createDeps({
      marker: { operationId: 'parent-op' },
      markerStatus: 'running',
      pending: [finished('a')],
    });

    await deliverBackgroundSubAgentResults(deps, {
      settledOperationId: 'parent-op',
      topicId: 'topic-1',
    });

    expect(deps.agentOperationModel.findById).not.toHaveBeenCalled();
    expect(deps.queueWakeup).toHaveBeenCalledTimes(1);
  });

  it('treats a mark left by a run that already ended as free', async () => {
    const deps = createDeps({
      marker: { operationId: 'old-op' },
      markerStatus: 'done',
      pending: [finished('a')],
    });

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

    expect(deps.queueWakeup).toHaveBeenCalledTimes(1);
  });

  it('only delivers what it claimed, so a racing delivery cannot repeat a result', async () => {
    const deps = createDeps({ pending: [finished('a'), finished('b')] });
    deps.messageModel.claimBackgroundSubAgentDelivery.mockResolvedValue(['b']);

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

    const [{ results }] = deps.appendResultMessages.mock.calls[0];
    expect(results.map((item: { callId: string }) => item.callId)).toEqual(['b']);
  });

  it('starts nothing when every result was already claimed', async () => {
    const deps = createDeps({ pending: [finished('a')] });
    deps.messageModel.claimBackgroundSubAgentDelivery.mockResolvedValue([]);

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

    expect(deps.appendResultMessages).not.toHaveBeenCalled();
    expect(deps.queueWakeup).not.toHaveBeenCalled();
  });

  it('hands the claims back when the turn cannot start', async () => {
    const deps = createDeps({ pending: [finished('a')] });
    deps.queueWakeup.mockRejectedValue(new Error('Topic topic-1 remained busy'));

    await expect(
      deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' }),
    ).resolves.toBeUndefined();

    expect(deps.messageModel.releaseBackgroundSubAgentDelivery).toHaveBeenCalledWith(['a']);
  });

  it('carries a failure as an error result', async () => {
    const deps = createDeps({
      pending: [finished('a', { state: { result: 'boom', status: 'error' } })],
    });

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

    const [{ results }] = deps.appendResultMessages.mock.calls[0];
    expect(results[0]).toMatchObject({ result: 'boom', status: 'error' });
  });

  it('leaves calls made inside a thread alone', async () => {
    const deps = createDeps({ pending: [finished('a', { threadId: 'user-thread' })] });

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

    expect(deps.messageModel.claimBackgroundSubAgentDelivery).not.toHaveBeenCalled();
    expect(deps.queueWakeup).not.toHaveBeenCalled();
  });

  it('never throws, even when the topic lookup fails', async () => {
    const deps = createDeps({});
    deps.topicModel.findById.mockRejectedValue(new Error('db down'));

    await expect(
      deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('wakeForBackgroundResults', () => {
  const wake = {
    agentId: 'agent-1',
    callbackMessageId: 'leaf-msg',
    originTopicId: 'topic-1',
    receiptId: 'subagent-cb-a',
    resultCount: 2,
  };
  const createWakeDeps = (channel: boolean) => ({
    execAgent: vi.fn().mockResolvedValue({ operationId: 'wake-op', success: true }),
    isChannelEnabled: vi.fn().mockResolvedValue(channel),
    queueWakeup: vi.fn().mockResolvedValue(undefined),
    resolveInterventionConfig: vi.fn().mockResolvedValue({ allowList: [], approvalMode: 'manual' }),
  });

  it('wakes the parent directly, as before, while Better Coding Experience is off', async () => {
    const deps = createWakeDeps(false);

    await wakeForBackgroundResults(deps, wake);

    expect(deps.queueWakeup).not.toHaveBeenCalled();
    expect(deps.execAgent).toHaveBeenCalledWith({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      autoStart: true,
      parentMessageId: 'leaf-msg',
      prompt: 'Process 2 finished background results',
      suppressUserMessage: true,
      trigger: RequestTrigger.Chat,
      userInterventionConfig: { allowList: [], approvalMode: 'manual' },
    });
  });

  it('uses the shared wake-up channel under the lab', async () => {
    const deps = createWakeDeps(true);

    await wakeForBackgroundResults(deps, wake);

    expect(deps.execAgent).not.toHaveBeenCalled();
    expect(deps.queueWakeup).toHaveBeenCalledWith({
      agentId: 'agent-1',
      callbackMessageId: 'leaf-msg',
      originTopicId: 'topic-1',
      receiptId: 'subagent-cb-a',
    });
  });

  it('throws when the direct wake does not start, so claims are handed back', async () => {
    const deps = createWakeDeps(false);
    deps.execAgent.mockResolvedValue({ error: 'no model', success: false });

    await expect(wakeForBackgroundResults(deps, wake)).rejects.toThrow('no model');
  });
});
