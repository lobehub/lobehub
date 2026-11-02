import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type BackgroundSubAgentDeliveryDeps,
  deliverBackgroundSubAgentResults,
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
    execAgent: vi.fn().mockResolvedValue({ operationId: 'wake-op', success: true }),
    messageModel: {
      claimBackgroundSubAgentDelivery: vi.fn(async (ids: string[]) => ids),
      listBackgroundSubAgentCalls: vi.fn().mockResolvedValue(opts.pending ?? []),
      releaseBackgroundSubAgentDelivery: vi.fn().mockResolvedValue(undefined),
    },
    resolveInterventionConfig: vi.fn().mockResolvedValue({ allowList: [], approvalMode: 'manual' }),
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
    expect(deps.execAgent).toHaveBeenCalledTimes(1);
    expect(deps.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-1' },
        autoStart: true,
        parentMessageId: 'leaf-msg',
        suppressUserMessage: true,
        trigger: RequestTrigger.Chat,
        userInterventionConfig: { allowList: [], approvalMode: 'manual' },
      }),
    );
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
    expect(deps.execAgent).not.toHaveBeenCalled();
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
    expect(deps.execAgent).toHaveBeenCalledTimes(1);
  });

  it('treats a mark left by a run that already ended as free', async () => {
    const deps = createDeps({
      marker: { operationId: 'old-op' },
      markerStatus: 'done',
      pending: [finished('a')],
    });

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

    expect(deps.execAgent).toHaveBeenCalledTimes(1);
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
    expect(deps.execAgent).not.toHaveBeenCalled();
  });

  it('hands the claims back when the turn cannot start', async () => {
    const deps = createDeps({ pending: [finished('a')] });
    deps.execAgent.mockRejectedValue(new Error('Topic topic-1 remained busy'));

    await expect(
      deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' }),
    ).resolves.toBeUndefined();

    expect(deps.messageModel.releaseBackgroundSubAgentDelivery).toHaveBeenCalledWith(['a']);
  });

  it('hands the claims back when the turn reports it did not start', async () => {
    const deps = createDeps({ pending: [finished('a')] });
    deps.execAgent.mockResolvedValue({ error: 'no model', success: false });

    await deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' });

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
    expect(deps.execAgent).not.toHaveBeenCalled();
  });

  it('never throws, even when the topic lookup fails', async () => {
    const deps = createDeps({});
    deps.topicModel.findById.mockRejectedValue(new Error('db down'));

    await expect(
      deliverBackgroundSubAgentResults(deps, { topicId: 'topic-1' }),
    ).resolves.toBeUndefined();
  });
});
