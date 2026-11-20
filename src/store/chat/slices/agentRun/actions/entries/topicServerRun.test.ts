import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { topicService } from '@/services/topic';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import type { ChatStore } from '@/store/chat/store';
import { notifyRunEndedWithoutRunner, notifyRunStopFailed } from '@/store/chat/utils/runStop';

import { TopicServerRunActionImpl, untrackedServerRunIdSelector } from './topicServerRun';

vi.mock('@/services/aiAgent', () => ({ aiAgentService: { interruptTask: vi.fn() } }));
vi.mock('@/services/topic', () => ({ topicService: { getTopicDetail: vi.fn() } }));
vi.mock('@/store/chat/utils/runStop', () => ({
  notifyRunEndedWithoutRunner: vi.fn(),
  notifyRunStopFailed: vi.fn(),
}));

const context = { agentId: 'agt-1', threadId: null, topicId: 'tpc-1' };
const marker = { assistantMessageId: 'msg-1', heteroType: 'devin', operationId: 'op-dead' };

const withTopic = (runningOperation: object | null = marker, status = 'running') =>
  vi
    .spyOn(topicSelectors, 'getTopicById')
    .mockReturnValue(() => ({ id: 'tpc-1', metadata: { runningOperation }, status }) as any);
const withLocalOperations = (operations: object[]) =>
  vi.spyOn(operationSelectors, 'getOperationsByContext').mockReturnValue(() => operations as any);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('untrackedServerRunIdSelector', () => {
  it('finds the server run of a topic no local operation follows', () => {
    // T-14643: the desktop runner was closed and the stream ended, but the
    // server still runs the topic — the composer must still offer Stop.
    withTopic();
    withLocalOperations([]);

    expect(untrackedServerRunIdSelector(context)({} as any)).toBe('op-dead');
  });

  it('leaves Stop to a local run, aborting or not', () => {
    withTopic();
    withLocalOperations([
      { metadata: { isAborting: true }, status: 'running', type: 'execServerAgentRuntime' },
    ]);

    expect(untrackedServerRunIdSelector(context)({} as any)).toBeUndefined();
  });

  it('ignores finished local operations, threads and topics without a run', () => {
    withTopic();
    withLocalOperations([{ status: 'completed', type: 'execServerAgentRuntime' }]);
    expect(untrackedServerRunIdSelector(context)({} as any)).toBe('op-dead');
    expect(
      untrackedServerRunIdSelector({ ...context, threadId: 'thd-1' })({} as any),
    ).toBeUndefined();

    withTopic(null, 'active');
    expect(untrackedServerRunIdSelector(context)({} as any)).toBeUndefined();
  });
});

describe('stopTopicServerRun', () => {
  const setup = () => {
    const state = { internal_dispatchTopic: vi.fn() } as unknown as ChatStore;
    const control = new TopicServerRunActionImpl(vi.fn(), () => state);
    return { control, state };
  };

  beforeEach(() => {
    vi.mocked(aiAgentService.interruptTask).mockReset();
    vi.mocked(topicService.getTopicDetail).mockReset();
    vi.mocked(notifyRunStopFailed).mockReset();
    vi.mocked(notifyRunEndedWithoutRunner).mockReset();
  });

  it('ends the run and mirrors the released topic from the server', async () => {
    withTopic();
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({
      completionReason: 'runner_disconnected',
      running: 1,
      stopped: 1,
      success: true,
    } as any);
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: 'tpc-1',
      metadata: {},
      status: 'active',
    } as any);
    const { control, state } = setup();

    await expect(control.stopTopicServerRun(context as any)).resolves.toBe(true);

    expect(aiAgentService.interruptTask).toHaveBeenCalledWith({ topicId: 'tpc-1' });
    expect(state.internal_dispatchTopic).toHaveBeenCalledWith({
      id: 'tpc-1',
      type: 'updateTopic',
      value: { metadata: { runningOperation: null }, status: 'active' },
    });
    expect(notifyRunEndedWithoutRunner).toHaveBeenCalledOnce();
    expect(notifyRunStopFailed).not.toHaveBeenCalled();
  });

  it('says why a stop failed and offers to force it', async () => {
    withTopic();
    vi.mocked(aiAgentService.interruptTask)
      .mockResolvedValueOnce({
        failureReason: 'runner_unconfirmed',
        running: 1,
        stopped: 0,
        success: false,
      } as any)
      .mockResolvedValueOnce({ running: 1, stopped: 1, success: true } as any);
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: 'tpc-1',
      metadata: {},
      status: 'active',
    } as any);
    const { control } = setup();

    await expect(control.stopTopicServerRun(context as any)).resolves.toBe(false);

    const [reason, forceStop] = vi.mocked(notifyRunStopFailed).mock.calls[0];
    expect(reason).toBe('runner_unconfirmed');
    expect(forceStop).toBeTypeOf('function');

    forceStop!();
    await vi.waitFor(() =>
      expect(aiAgentService.interruptTask).toHaveBeenLastCalledWith({
        force: true,
        topicId: 'tpc-1',
      }),
    );
  });

  it('offers no second force after a forced stop fails', async () => {
    withTopic();
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({ success: false } as any);
    const { control } = setup();

    await control.stopTopicServerRun(context as any, { force: true });

    expect(vi.mocked(notifyRunStopFailed).mock.calls[0]).toEqual([undefined, undefined]);
  });

  it('answers a click on a run it could not reach', async () => {
    // Nothing of the caller's was live and the server kept the marker: a
    // teammate's run. The click must not go unanswered.
    withTopic();
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({
      running: 0,
      stopped: 0,
      success: true,
    } as any);
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: 'tpc-1',
      metadata: { runningOperation: marker },
      status: 'running',
    } as any);
    const { control } = setup();

    await expect(control.stopTopicServerRun(context as any)).resolves.toBe(false);
    expect(notifyRunStopFailed).toHaveBeenCalledWith(undefined);
  });

  it('reports a request that failed outright', async () => {
    withTopic();
    vi.mocked(aiAgentService.interruptTask).mockRejectedValue(new Error('offline'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { control } = setup();

    await expect(control.stopTopicServerRun(context as any)).resolves.toBe(false);
    expect(notifyRunStopFailed).toHaveBeenCalledWith(undefined);
    consoleError.mockRestore();
  });
});
