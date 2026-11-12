import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
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

const typedDraft = { root: { children: [], type: 'root' } };
const agentId = TEST_IDS.SESSION_ID;
const topicId = 'tpc_existing';

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
  useUserStore.setState({ workspaceUserPreference: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Sends through a gateway transport that parks before (or, with `sendRequest`,
 * after) sending its start request, presses Stop there (the ChatInput
 * `stopGenerating` sequence), then lets the transport `finish`.
 */
const sendAndStop = async ({
  finish,
  sendRequest,
}: {
  finish: () => Promise<unknown>;
  sendRequest: boolean;
}) => {
  const { result } = renderHook(() => useChatStore());
  const editor = {
    clearContent: vi.fn(),
    getJSONState: vi.fn(() => typedDraft),
    getMarkdownContent: vi.fn(() => 'hello'),
    setDocument: vi.fn(),
    setJSONState: vi.fn(),
  };
  let parked!: () => void;
  const reached = new Promise<void>((resolve) => {
    parked = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  act(() => {
    useChatStore.setState({
      activeAgentId: agentId,
      activeTopicId: topicId,
      executeClientAgent: vi.fn(),
      executeGatewayAgent: vi.fn(async (params: any) => {
        if (sendRequest) params.onStartRequestSent?.();
        parked();
        await released;
        return finish();
      }) as any,
      isGatewayModeEnabled: () => true,
      mainInputEditor: editor as any,
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
    });
  });

  const context = { agentId, threadId: null, topicId };
  let sending!: Promise<unknown>;
  await act(async () => {
    sending = result.current.sendMessage({ context, message: 'hello' });
    await reached;
  });

  act(() => {
    const store = useChatStore.getState();
    store.cancelOperations(
      { ...context, status: 'running', type: INPUT_LOADING_OPERATION_TYPES },
      MESSAGE_CANCEL_FLAT,
    );
    store.cancelSendMessageInServer(context, editor as any);
  });

  await act(async () => {
    release();
    await sending;
  });

  return editor;
};

describe('Stop while a gateway send is starting', () => {
  // ROOT CAUSE:
  //
  // The gateway start request is never aborted: the server persists the turn
  // whatever the client does. A Stop while it was in flight still replayed the
  // pre-send editor snapshot, so the composer held the text again while the
  // persisted user message was back in the conversation: a duplicate.
  //
  // Before: the composer was restored. After: the message stays sent.
  it('does not hand the text back once the start request is sent', async () => {
    const editor = await sendAndStop({
      finish: async () => ({ assistantMessageId: 'ast-1', topicId, userMessageId: 'usr-1' }),
      sendRequest: true,
    });

    expect(editor.setJSONState).not.toHaveBeenCalled();
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it('still restores the composer when Stop lands before the request is sent', async () => {
    const editor = await sendAndStop({
      finish: () => Promise.reject(new DOMException('Aborted', 'AbortError')),
      sendRequest: false,
    });

    expect(editor.setJSONState).toHaveBeenCalledWith(typedDraft);
  });

  it('hands the text back when the server refuses a turn stopped in flight', async () => {
    const editor = await sendAndStop({
      finish: () => Promise.reject(new Error('AgentConcurrencyLimitExceeded')),
      sendRequest: true,
    });

    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'hello');
  });
});
