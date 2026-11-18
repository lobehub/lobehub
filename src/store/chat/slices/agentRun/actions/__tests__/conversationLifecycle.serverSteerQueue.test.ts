import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiAgentService } from '@/services/aiAgent';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';

import { topicSelectors } from '../../../../selectors';
import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { resetReleasedMarkers } from '../transports/gateway/untrackedHeteroRun';
import { createMockAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

vi.mock('../transports/hetero/heterogeneousAgentExecutor', () => ({
  executeHeterogeneousAgent: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } },
  },
}));

const context = { agentId: TEST_IDS.SESSION_ID, threadId: null, topicId: TEST_IDS.TOPIC_ID };
const contextKey = messageMapKey(context);

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
  vi.spyOn(aiAgentService, 'setQueuedMessages').mockResolvedValue(undefined as never);
  vi.spyOn(aiAgentService, 'listQueuedFollowUps').mockResolvedValue([]);
  useUserStore.setState({ workspaceUserPreference: {} });

  act(() => {
    useChatStore.setState({
      executeClientAgent: vi.fn(),
      executeGatewayAgent: vi.fn(),
      isGatewayModeEnabled: () => true,
      mainInputEditor: null,
      operations: {
        'op-running': {
          childOperationIds: [],
          context,
          id: 'op-running',
          metadata: { serverOperationId: 'op-server' },
          status: 'running',
          type: 'execServerAgentRuntime',
        },
      } as any,
      operationsByContext: { [contextKey]: ['op-running'] },
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendMessage behind a running Gateway run', () => {
  it('queues the follow-up on the server, so the run reads it before its next model call', async () => {
    const { result } = renderHook(() => useChatStore());
    const append = vi
      .spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockResolvedValue({ id: 'x', length: 1, queued: true });

    await act(async () => {
      await result.current.sendMessage({ context, message: 'also check the tests' });
    });

    await vi.waitFor(() =>
      expect(useChatStore.getState().queuedMessages[contextKey]?.[0]?.serverDelivery).toBe(
        'server',
      ),
    );
    const [{ id, request }] = append.mock.calls[0];
    expect(id).toBe(useChatStore.getState().queuedMessages[contextKey][0].id);
    expect(request).toMatchObject({
      agentId: TEST_IDS.SESSION_ID,
      appContext: { topicId: TEST_IDS.TOPIC_ID },
      prompt: 'also check the tests',
    });
    // The server joins it; the run is not told to hand its turn back.
    expect(aiAgentService.setQueuedMessages).not.toHaveBeenCalled();
    expect(result.current.executeGatewayAgent).not.toHaveBeenCalled();
  });

  it('carries the content attached from the conversation or a page with the queued request', async () => {
    const { result } = renderHook(() => useChatStore());
    const append = vi
      .spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockResolvedValue({ id: 'x', length: 1, queued: true, state: 'queued' } as any);
    const contextSelections = [{ content: 'snippet', id: 'sel-1', type: 'text' }] as any;
    const pageSelections = [{ content: 'para', id: 'pg-1', pageId: 'doc-1' }] as any;

    await act(async () => {
      await result.current.sendMessage({
        context,
        contextSelections,
        message: 'about this',
        pageSelections,
      });
    });

    await vi.waitFor(() => expect(append).toHaveBeenCalled());
    expect(append.mock.calls[0][0].request).toMatchObject({ contextSelections, pageSelections });
  });

  it('keeps the follow-up in this client when the agent does not run on the Gateway', async () => {
    act(() => {
      useChatStore.setState({ isGatewayModeEnabled: () => false });
    });
    const { result } = renderHook(() => useChatStore());
    const append = vi.spyOn(aiAgentService, 'appendQueuedFollowUp');

    await act(async () => {
      await result.current.sendMessage({ context, message: 'also check the tests' });
    });

    expect(append).not.toHaveBeenCalled();
    const [queued] = useChatStore.getState().queuedMessages[contextKey];
    expect(queued.content).toBe('also check the tests');
    expect(queued.serverDelivery).toBeUndefined();
    expect(aiAgentService.setQueuedMessages).toHaveBeenCalledWith({
      operationId: 'op-server',
      pending: true,
    });
  });

  // ROOT CAUSE:
  //
  // Follow-ups restored behind an idle topic (or left by a failed run) were
  // only sent after a newer message's turn finished: the newer send started
  // at once and overtook them.
  //
  // Before: only a queue behind a Stop was folded into the new send.
  // After: any queue nothing drains goes first, together with the new send.
  it('sends follow-ups still queued here before a newer send, in one turn', async () => {
    vi.useFakeTimers();
    const sendQueued = vi.fn().mockResolvedValue(undefined);
    act(() => {
      useChatStore.setState({
        operations: {},
        operationsByContext: {},
        queuedMessages: {
          [contextKey]: [{ content: 'earlier', createdAt: 1, id: 'q0', interruptMode: 'soft' }],
        },
      });
    });
    const { result } = renderHook(() => useChatStore());
    const original = result.current.sendMessage;

    await act(async () => {
      await original({ context, message: 'newer' });
    });
    useChatStore.setState({ sendMessage: sendQueued });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    vi.useRealTimers();

    expect(sendQueued).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'earlier\n\nnewer' }),
    );
    // The drained messages open a turn of their own, so they are not marked.
    expect(sendQueued.mock.calls[0][0].metadata?.steer).toBeUndefined();
  });

  it('waits behind a follow-up a run is still delivering, instead of overtaking it', async () => {
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockResolvedValue({
      removed: false,
      state: 'delivering',
    });
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'x',
      length: 2,
      queued: true,
    });
    const serverRequest = {
      agentId: TEST_IDS.SESSION_ID,
      appContext: { topicId: TEST_IDS.TOPIC_ID },
      prompt: 'earlier',
    };
    act(() => {
      useChatStore.setState({
        operations: {},
        operationsByContext: {},
        queuedMessages: {
          [contextKey]: [
            {
              content: 'earlier',
              createdAt: 1,
              id: 'q0',
              interruptMode: 'soft',
              serverDelivery: 'server',
              serverRequest,
            },
          ],
        },
      });
    });
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.sendMessage({ context, message: 'newer' });
    });

    expect(result.current.executeGatewayAgent).not.toHaveBeenCalled();
    expect(useChatStore.getState().queuedMessages[contextKey].map((m) => m.content)).toEqual([
      'earlier',
      'newer',
    ]);
  });
});

// ROOT CAUSE (T-13930):
//
// The gateway ends the local operation of a Claude Code run on a transport
// signal alone (a terminal resume status after a quiet socket), while the
// server keeps the topic marker because the CLI is still working — e.g. waiting
// on a background download. The composer then looked idle, and the next message
// started a second run: the topic moved to it, the live CLI's output was
// discarded as stale, and the CLI stopped its agent and the background work.
//
// Before: no local operation → a fresh send, next to the live run.
// After: the send is queued on the server, which types it into the live session.
describe('sendMessage while the topic names a hetero run this tab no longer follows', () => {
  const marker = {
    assistantMessageId: 'msg-assistant',
    heteroType: 'claude-code',
    operationId: 'op-hetero-live',
  };

  beforeEach(() => {
    act(() => {
      useChatStore.setState({
        operations: {},
        operationsByContext: {},
        reconnectToGatewayOperation: vi.fn().mockResolvedValue(undefined),
      });
    });
    vi.spyOn(topicSelectors, 'getTopicById').mockReturnValue(
      () => ({ id: TEST_IDS.TOPIC_ID, metadata: { runningOperation: marker } }) as any,
    );
  });

  afterEach(() => {
    resetReleasedMarkers();
  });

  it('steers the live run through the server queue and re-attaches its stream', async () => {
    const append = vi
      .spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockResolvedValue({ id: 'x', length: 1, queued: true });
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.sendMessage({ context, message: '怎么样了' });
    });

    await vi.waitFor(() => expect(append).toHaveBeenCalled());
    expect(append.mock.calls[0][0].request).toMatchObject({ prompt: '怎么样了' });
    expect(result.current.executeGatewayAgent).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(result.current.reconnectToGatewayOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'op-hetero-live', topicId: TEST_IDS.TOPIC_ID }),
      ),
    );
  });

  // `full` / `unavailable` used to bounce: the fallback re-entered the send,
  // which queued behind the same marker again every 100ms, never sending.
  it.each(['idle', 'full', 'unavailable'])(
    'sends fresh once the server does not take the follow-up (%s)',
    async (reason) => {
      vi.useFakeTimers();
      vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
        queued: false,
        reason,
      } as any);
      const sendQueued = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useChatStore());
      const original = result.current.sendMessage;

      await act(async () => {
        await original({ context, message: 'hello' });
      });
      useChatStore.setState({ sendMessage: sendQueued });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      vi.useRealTimers();

      // The client sends it itself; a re-entry no longer queues behind the stale marker.
      expect(sendQueued).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello' }));
      // No local reconnect op was started that could block that send.
      expect(useChatStore.getState().reconnectToGatewayOperation).not.toHaveBeenCalled();
      useChatStore.setState({ sendMessage: original });
      await act(async () => {
        await useChatStore.getState().sendMessage({ context, message: 'again' });
      });
      expect(useChatStore.getState().executeGatewayAgent).toHaveBeenCalled();
    },
  );
});
