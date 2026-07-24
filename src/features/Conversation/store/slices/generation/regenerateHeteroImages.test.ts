import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ConversationContext } from '../../../types';
import { createStore } from '../../index';

// ── Mock the hetero runtime seam ──
// regenerate (hetero) re-creates an assistant row, then delegates to
// `executeHeterogeneousAgent`. We spy on that boundary and assert the original
// user message's `imageList` is forwarded — the regression this guards against
// is regenerate silently dropping image attachments (the send path forwards
// them; this path must too).
const mockExecuteHeterogeneousAgent = vi.fn();
vi.mock(
  '@/store/chat/slices/agentRun/actions/transports/hetero/heterogeneousAgentExecutor',
  () => ({
    executeHeterogeneousAgent: (...args: any[]) => mockExecuteHeterogeneousAgent(...args),
  }),
);

vi.mock('@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher', () => ({
  selectRuntimeType: () => 'hetero',
}));

vi.mock('@/store/chat/slices/agentRun/actions/transports/hetero/heteroResume', () => ({
  resolveHeteroResume: () => ({ cwdChanged: false, resumeSessionId: 'sess-1' }),
}));

vi.mock('@/store/chat/utils/activeTopicDocumentContext', () => ({
  mergeAgentRuntimeInitialContexts: () => undefined,
  resolveActiveTopicDocumentInitialContext: async () => undefined,
}));

vi.mock('@/store/chat/slices/operation/selectors', () => ({
  operationSelectors: {
    getOperationById: () => () => undefined,
    isMessageProcessing: () => () => false,
  },
}));

vi.mock('@/services/message', () => ({
  messageService: { createMessage: vi.fn(async () => ({ id: 'assistant-new' })) },
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({ localAgentWorkingDirectoryMap: {} }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentById: () => () => undefined,
    isWorkspaceAgentById: () => () => false,
  },
  agentSelectors: {
    getAgentConfigById: () => () => ({
      agencyConfig: {
        executionTarget: 'local',
        heterogeneousProvider: { type: 'claude-code' },
        workingDirByDevice: { 'device-1': '/work/dir' },
      },
    }),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { getTopicById: () => () => undefined },
}));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: 'device-1' } }),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: { info: vi.fn() },
}));

const noop = vi.fn();
vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      operations: {},
      operationsByMessage: {},

      associateMessageWithOperation: noop,
      completeOperation: noop,
      failOperation: noop,
      internal_updateTopicLoading: noop,
      isGatewayModeEnabled: () => false,
      refreshMessages: vi.fn(async () => {}),
      startOperation: vi.fn(() => ({ operationId: 'hetero-op-id' })),
      switchMessageBranch: vi.fn(async () => {}),
    })),
    setState: vi.fn(),
  },
}));

describe('regenerateUserMessage (hetero) — image forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the original user message imageList to executeHeterogeneousAgent', async () => {
    const context: ConversationContext = {
      agentId: 'agent-1',
      topicId: 'topic-1',
      threadId: null,
    };

    const imageList = [{ alt: 'shot.png', id: 'img-1', url: 'https://x/img-1.png' }];

    const store = createStore({ context });
    act(() => {
      store.setState({
        displayMessages: [{ content: 'describe this', id: 'msg-1', imageList, role: 'user' }],
        dbMessages: [{ content: 'describe this', id: 'msg-1', role: 'user' }],
      } as any);
    });

    await act(async () => {
      await store.getState().regenerateUserMessage('msg-1');
    });

    expect(mockExecuteHeterogeneousAgent).toHaveBeenCalledTimes(1);
    const [, params] = mockExecuteHeterogeneousAgent.mock.calls[0];
    expect(params).toMatchObject({
      assistantMessageId: 'assistant-new',
      imageList,
      message: 'describe this',
    });
  });

  it('passes undefined imageList when the original message had no images', async () => {
    const context: ConversationContext = {
      agentId: 'agent-1',
      topicId: 'topic-1',
      threadId: null,
    };

    const store = createStore({ context });
    act(() => {
      store.setState({
        displayMessages: [{ content: 'hello', id: 'msg-1', role: 'user' }],
        dbMessages: [{ content: 'hello', id: 'msg-1', role: 'user' }],
      } as any);
    });

    await act(async () => {
      await store.getState().regenerateUserMessage('msg-1');
    });

    expect(mockExecuteHeterogeneousAgent).toHaveBeenCalledTimes(1);
    const [, params] = mockExecuteHeterogeneousAgent.mock.calls[0];
    expect(params.imageList).toBeUndefined();
  });
});
