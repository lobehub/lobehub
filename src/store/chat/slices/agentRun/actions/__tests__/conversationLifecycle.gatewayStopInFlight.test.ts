import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { getElectronStoreState } from '@/store/electron/store';
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
  draftAfterStop = '',
  finish,
  sendRequest,
}: {
  /** What the user typed into the composer after pressing Stop. */
  draftAfterStop?: string;
  finish: (params: any) => Promise<unknown>;
  sendRequest: boolean;
}) => {
  const { result } = renderHook(() => useChatStore());
  const editor = {
    clearContent: vi.fn(),
    getJSONState: vi.fn(() => typedDraft),
    getMarkdownContent: vi.fn(() => ''),
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
        return finish(params);
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
  editor.getMarkdownContent.mockReturnValue(draftAfterStop);

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

  // ROOT CAUSE:
  //
  // Before the request is sent, `executeGatewayAgent` rethrows the signal's
  // abort reason (`'canceled'`, a string). The failed-send restore only knew
  // `AbortError`s, so it also recorded the Stop as an "Unknown error" notice.
  //
  // Before: the composer came back with a send-error banner. After: silently.
  it('still restores the composer silently when Stop lands before the request is sent', async () => {
    const editor = await sendAndStop({
      finish: (params) =>
        Promise.reject(
          useChatStore.getState().getOperationAbortSignal(params.parentOperationId).reason,
        ),
      sendRequest: false,
    });

    expect(editor.setJSONState).toHaveBeenCalledWith(typedDraft);
    expect(editor.setDocument).not.toHaveBeenCalled();
    const send = Object.values(useChatStore.getState().operations).find(
      (operation) => operation.type === 'sendMessage',
    );
    expect(send?.status).toBe('cancelled');
    expect(send?.metadata.inputSendErrorMsg).toBeUndefined();
  });

  it('hands the text back when the server refuses a turn stopped in flight', async () => {
    const editor = await sendAndStop({
      finish: () => Promise.reject(new Error('AgentConcurrencyLimitExceeded')),
      sendRequest: true,
    });

    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'hello');
  });

  // ROOT CAUSE:
  //
  // The refusal now arrives after Stop, so the user may already be typing the
  // next message. The restore wrote the refused text over that new draft.
  //
  // Before: the new draft was replaced. After: it is kept.
  it('keeps a draft typed after Stop when the server later refuses the turn', async () => {
    const editor = await sendAndStop({
      draftAfterStop: 'a new draft',
      finish: () => Promise.reject(new Error('AgentConcurrencyLimitExceeded')),
      sendRequest: true,
    });

    expect(editor.setDocument).not.toHaveBeenCalled();
    expect(editor.setJSONState).not.toHaveBeenCalled();
  });

  // ROOT CAUSE:
  //
  // The restorable snapshot was written only after the send's preflight awaits
  // (topic lookup, device id). A Stop there found no snapshot to replay, and
  // the abort that later reached the failed-send restore is skipped as a Stop,
  // so the draft was never handed back.
  //
  // Before: the composer stayed empty. After: the exact draft comes back.
  it('hands the draft back when Stop lands during the preflight awaits', async () => {
    const { result } = renderHook(() => useChatStore());
    const editor = {
      clearContent: vi.fn(),
      getJSONState: vi.fn(() => typedDraft),
      getMarkdownContent: vi.fn(() => ''),
      setDocument: vi.fn(),
      setJSONState: vi.fn(),
    };
    let releasePreflight!: () => void;
    const preflight = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });
    const resolveGatewayDeviceId = vi.fn(async () => {
      await preflight;
      return undefined;
    });
    vi.spyOn(getElectronStoreState(), 'resolveGatewayDeviceId').mockImplementation(
      resolveGatewayDeviceId as any,
    );
    // Before sending, the real transport rethrows the aborted signal's reason.
    const executeGatewayAgent = vi.fn(async (params: any) => {
      const signal = useChatStore.getState().getOperationAbortSignal(params.parentOperationId);
      if (signal.aborted) throw signal.reason;
      return { topicId };
    });
    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        activeTopicId: topicId,
        executeGatewayAgent: executeGatewayAgent as any,
        isGatewayModeEnabled: () => true,
        mainInputEditor: editor as any,
      });
    });

    const context = { agentId, threadId: null, topicId };
    let sending!: Promise<unknown>;
    await act(async () => {
      sending = result.current.sendMessage({ context, message: 'hello' });
      await vi.waitFor(() => expect(resolveGatewayDeviceId).toHaveBeenCalled());
    });

    act(() => {
      const store = useChatStore.getState();
      store.cancelOperations(
        { ...context, status: 'running', type: INPUT_LOADING_OPERATION_TYPES },
        MESSAGE_CANCEL_FLAT,
      );
      store.cancelSendMessageInServer(context, editor as any);
    });
    expect(editor.setJSONState).toHaveBeenCalledWith(typedDraft);

    await act(async () => {
      releasePreflight();
      await sending;
    });

    expect(executeGatewayAgent).toHaveBeenCalledOnce();
    expect(editor.setJSONState).toHaveBeenCalledOnce();
    expect(editor.setDocument).not.toHaveBeenCalled();
    const send = Object.values(useChatStore.getState().operations).find(
      (operation) => operation.type === 'sendMessage',
    );
    expect(send?.status).toBe('cancelled');
    expect(send?.metadata.inputSendErrorMsg).toBeUndefined();
  });
});
