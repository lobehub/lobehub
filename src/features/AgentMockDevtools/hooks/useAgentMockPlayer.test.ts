import type { MockCase } from '@lobechat/agent-mock';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentMockStore } from '../store/agentMockStore';
import { useAgentMockPlayer } from './useAgentMockPlayer';

const { executeMockStream, getChatStoreState, lastDisplayMessageId } = vi.hoisted(() => ({
  executeMockStream: vi.fn(),
  getChatStoreState: vi.fn(),
  lastDisplayMessageId: vi.fn(),
}));

vi.mock('@lobechat/agent-mock', () => ({
  executeMockStream,
}));

vi.mock('@/store/chat/slices/message/selectors', () => ({
  displayMessageSelectors: {
    lastDisplayMessageId,
  },
}));

vi.mock('@/store/chat/store', () => ({
  useChatStore: {
    getState: getChatStoreState,
  },
}));

const mockCase: MockCase = {
  id: 'case-1',
  name: 'Case 1',
  source: { events: [], type: 'fixture' },
};

const createMockHandle = () => ({
  player: {
    pause: vi.fn(),
    resume: vi.fn(),
    seekToEventIndex: vi.fn(),
    setSpeed: vi.fn(),
    stepNextEvent: vi.fn(),
    stepNextStep: vi.fn(),
    stepNextTool: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
  start: vi.fn(),
  stop: vi.fn(),
});

const createChatStoreMock = (overrides: Record<string, unknown> = {}) => ({
  associateMessageWithOperation: vi.fn(),
  activeAgentId: 'agent-1',
  activeGroupId: undefined,
  cancelOperation: vi.fn(),
  cancelOperations: vi.fn(),
  completeOperation: vi.fn(),
  dbMessagesMap: {},
  failOperation: vi.fn(),
  internal_dispatchMessage: vi.fn(),
  internal_dispatchTopic: vi.fn(),
  internal_toggleToolCallingStreaming: vi.fn(),
  internal_updateTopicLoading: vi.fn(),
  operations: {},
  operationsByMessage: {},
  optimisticCreateTmpMessage: vi.fn(),
  startOperation: vi.fn(),
  topicDataMap: {},
  ...overrides,
});

describe('useAgentMockPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAgentMockStore.setState({
      activeTab: 'timeline',
      loop: false,
      modalOpen: false,
      playback: null,
      popoverOpen: false,
      selectedCaseId: null,
      speed: 1,
    });
  });

  it('creates a frontend operation and injects an assistant message before starting playback', async () => {
    const handle = createMockHandle();
    const chatStore = createChatStoreMock();

    executeMockStream.mockReturnValue(handle);
    getChatStoreState.mockReturnValue(chatStore);
    lastDisplayMessageId.mockReturnValue('user-1');

    const { result } = renderHook(() => useAgentMockPlayer());

    act(() => {
      result.current.start({ agentId: 'agent-1', case: mockCase, topicId: 'topic-1' });
    });

    const operationId = chatStore.startOperation.mock.calls[0][0].operationId as string;

    expect(chatStore.cancelOperations).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        topicId: 'topic-1',
        type: ['execAgentRuntime', 'execHeterogeneousAgent', 'execServerAgentRuntime'],
      },
      'Mock playback started',
    );
    expect(chatStore.startOperation).toHaveBeenCalledWith({
      context: {
        agentId: 'agent-1',
        messageId: `mock-msg-${operationId}`,
        scope: 'main',
        topicId: 'topic-1',
      },
      operationId,
      type: 'execAgentRuntime',
    });
    expect(chatStore.optimisticCreateTmpMessage).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        content: '',
        parentId: 'user-1',
        role: 'assistant',
        topicId: 'topic-1',
      },
      { operationId, tempMessageId: `mock-msg-${operationId}` },
    );
    expect(chatStore.associateMessageWithOperation).toHaveBeenCalledWith(
      `mock-msg-${operationId}`,
      operationId,
    );
    expect(executeMockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        case: mockCase,
        onEvent: expect.any(Function),
        operationId,
      }),
    );
    expect(handle.start).toHaveBeenCalled();
  });

  it('injects stream chunks into the frontend message store', async () => {
    const handle = createMockHandle();
    const chatStore = createChatStoreMock({
      completeOperation: vi.fn(),
      failOperation: vi.fn(),
      internal_toggleToolCallingStreaming: vi.fn(),
    });

    executeMockStream.mockReturnValue(handle);
    getChatStoreState.mockReturnValue(chatStore);
    lastDisplayMessageId.mockReturnValue('user-1');

    const { result } = renderHook(() => useAgentMockPlayer());

    act(() => {
      result.current.start({ agentId: 'agent-1', case: mockCase, topicId: 'topic-1' });
    });

    const operationId = chatStore.startOperation.mock.calls[0][0].operationId as string;
    const onEvent = executeMockStream.mock.calls[0][0].onEvent;

    act(() => {
      onEvent({
        data: { chunkType: 'text', content: 'hello' },
        operationId,
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'stream_chunk',
      });
    });

    expect(chatStore.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: `mock-msg-${operationId}`,
        type: 'updateMessage',
        value: { content: 'hello' },
      },
      { operationId },
    );
  });

  it('completes the frontend operation when the mock stream ends', async () => {
    const handle = createMockHandle();
    const chatStore = createChatStoreMock({
      completeOperation: vi.fn(),
      failOperation: vi.fn(),
      internal_toggleToolCallingStreaming: vi.fn(),
    });

    executeMockStream.mockReturnValue(handle);
    getChatStoreState.mockReturnValue(chatStore);
    lastDisplayMessageId.mockReturnValue('user-1');

    const { result } = renderHook(() => useAgentMockPlayer());

    act(() => {
      result.current.start({ agentId: 'agent-1', case: mockCase, topicId: 'topic-1' });
    });

    const operationId = chatStore.startOperation.mock.calls[0][0].operationId as string;
    const onEvent = executeMockStream.mock.calls[0][0].onEvent;

    act(() => {
      onEvent({
        data: { reason: 'done' },
        operationId,
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'agent_runtime_end',
      });
    });

    expect(chatStore.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
      `mock-msg-${operationId}`,
      undefined,
    );
    expect(chatStore.completeOperation).toHaveBeenCalledWith(operationId);
  });

  it('cancels the frontend operation when playback stops', async () => {
    const handle = createMockHandle();
    const chatStore = createChatStoreMock();

    executeMockStream.mockReturnValue(handle);
    getChatStoreState.mockReturnValue(chatStore);
    lastDisplayMessageId.mockReturnValue('user-1');

    const { result } = renderHook(() => useAgentMockPlayer());

    act(() => {
      result.current.start({ agentId: 'agent-1', case: mockCase, topicId: 'topic-1' });
    });

    const operationId = chatStore.startOperation.mock.calls[0][0].operationId as string;

    act(() => {
      result.current.stop();
    });

    expect(handle.stop).toHaveBeenCalled();
    expect(chatStore.cancelOperation).toHaveBeenCalledWith(operationId, 'Mock playback stopped');
  });

  it('shares the same playback handle across hook instances', async () => {
    const handle = createMockHandle();
    const chatStore = createChatStoreMock();

    executeMockStream.mockReturnValue(handle);
    getChatStoreState.mockReturnValue(chatStore);
    lastDisplayMessageId.mockReturnValue('user-1');

    const first = renderHook(() => useAgentMockPlayer());
    const second = renderHook(() => useAgentMockPlayer());

    act(() => {
      first.result.current.start({ agentId: 'agent-1', case: mockCase, topicId: 'topic-1' });
    });

    act(() => {
      second.result.current.pause();
      second.result.current.resume();
      second.result.current.stepStep();
    });

    expect(handle.player.pause).toHaveBeenCalledTimes(1);
    expect(handle.player.resume).toHaveBeenCalledTimes(1);
    expect(handle.player.stepNextStep).toHaveBeenCalledTimes(1);
  });

  it('reuses the running server assistant message instead of creating a second message', async () => {
    const handle = createMockHandle();
    const chatStore = createChatStoreMock({
      dbMessagesMap: {
        'main_agent-1_topic-1': [
          { content: 'hello', id: 'user-1', role: 'user' },
          { content: '', id: 'server-assistant-1', parentId: 'user-1', role: 'assistant' },
        ],
      },
      operations: {
        'server-op-1': {
          id: 'server-op-1',
          status: 'running',
          type: 'execServerAgentRuntime',
        },
      },
      operationsByMessage: {
        'server-assistant-1': ['server-op-1'],
      },
    });

    executeMockStream.mockReturnValue(handle);
    getChatStoreState.mockReturnValue(chatStore);
    lastDisplayMessageId.mockReturnValue('server-assistant-1');

    const { result } = renderHook(() => useAgentMockPlayer());

    act(() => {
      result.current.start({ agentId: 'agent-1', case: mockCase, topicId: 'topic-1' });
    });

    const operationId = chatStore.startOperation.mock.calls[0][0].operationId as string;

    expect(chatStore.cancelOperation).toHaveBeenCalledWith('server-op-1', 'Mock playback started');
    expect(chatStore.startOperation).toHaveBeenCalledWith({
      context: {
        agentId: 'agent-1',
        messageId: 'server-assistant-1',
        scope: 'main',
        topicId: 'topic-1',
      },
      operationId,
      type: 'execAgentRuntime',
    });
    expect(chatStore.optimisticCreateTmpMessage).not.toHaveBeenCalled();
    expect(chatStore.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'server-assistant-1',
        type: 'updateMessage',
        value: { content: '', error: undefined },
      },
      { operationId },
    );
    expect(chatStore.associateMessageWithOperation).toHaveBeenCalledWith(
      'server-assistant-1',
      operationId,
    );
  });
});
