import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { LOADING_FLAT } from '@lobechat/const';
import type { UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { aiAgentService, type ExecAgentResult } from '@/services/aiAgent';
import { messageService } from '@/services/message';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { GatewayActionImpl } from '../transports/gateway/gateway';

vi.mock('../transports/gateway/serverSteerQueue', () => ({
  reclaimServerQueuedMessages: vi.fn().mockResolvedValue(undefined),
  restoreServerQueuedMessages: vi.fn(),
  withdrawQueuedMessage: vi.fn(),
}));

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { execAgentTask: vi.fn(), interruptTask: vi.fn(), refreshGatewayToken: vi.fn() },
}));

vi.mock('@/services/shareChat', () => ({
  shareChatService: { execAgentTask: vi.fn(), interruptTask: vi.fn() },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn().mockResolvedValue([]),
    updateMessageError: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/services/topic', () => ({
  topicService: {
    getTopicDetail: vi.fn().mockResolvedValue(null),
    settleRunningOperation: vi.fn().mockResolvedValue(undefined),
    updateTopicMetadata: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: () => ({ moveChatComposerAttachments: vi.fn() }),
}));

const mockUserState = vi.hoisted(() => ({
  profile: { id: 'user-1' },
  workspaceUserPreference: { agentDeviceOverrides: {} as Record<string, any> },
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: vi.fn(() => mockUserState),
  useUserStore: { getState: vi.fn(() => mockUserState) },
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: { defaultAgentConfig: () => ({ chatConfig: {} }) },
  toolInterventionSelectors: { allowList: () => [], approvalMode: () => 'manual' },
  userGeneralSettingsSelectors: { telemetry: () => false },
  userProfileSelectors: { userId: (state: typeof mockUserState) => state.profile.id },
}));

vi.mock('@/const/version', async (importOriginal) => ({
  ...(await importOriginal<typeof ConstVersion>()),
  isDesktop: false,
}));

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: vi.fn() },
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({ activeAgentId: undefined, agentMap: {} }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => undefined,
    getAgentById: () => () => undefined,
  },
  agentSelectors: { currentAgentWorkingDirectory: () => () => undefined },
  chatConfigByIdSelectors: {
    getChatConfigById: () => () => ({}),
    isChatModeById: () => () => false,
    isLocalSystemEnabledById: () => () => false,
  },
}));

vi.mock('@/store/chat/utils/desktopNotification', () => ({
  notifyDesktopAgentFailed: vi.fn().mockResolvedValue(undefined),
  notifyDesktopAgentFinished: vi.fn().mockResolvedValue(undefined),
  notifyDesktopHumanApprovalRequired: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as any).window;
});

const user = { content: 'Count to four', id: 'usr-1', role: 'user' } as UIChatMessage;
/** The assistant row as the DB holds it until the interrupted step returns. */
const placeholder = {
  content: LOADING_FLAT,
  id: 'ast-1',
  parentId: 'usr-1',
  role: 'assistant',
} as UIChatMessage;

const serverResult: ExecAgentResult = {
  agentId: 'agent-1',
  assistantMessageId: 'ast-1',
  autoStarted: true,
  createdAt: new Date().toISOString(),
  message: 'ok',
  operationId: 'server-op',
  status: 'created',
  success: true,
  timestamp: new Date().toISOString(),
  token: 'test-token',
  topicId: 'topic-1',
  userMessageId: 'usr-1',
};

let eventSeq = 0;
const event = (type: AgentStreamEvent['type'], data?: unknown): AgentStreamEvent => ({
  data,
  id: String((eventSeq += 1)),
  operationId: 'server-op',
  stepIndex: 0,
  timestamp: Date.now(),
  type,
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

/**
 * A ChatStore stand-in whose message buckets follow every write the transport
 * and its event handler make, so assertions read what the conversation shows.
 */
const createConversationStore = () => {
  let opSeq = 0;
  const state: Record<string, any> = {
    dbMessagesMap: {},
    gatewayConnections: {},
    gatewayFeed: {},
    operations: {},
    operationsByContext: {},
    topicDataMap: {},
  };
  const set = vi.fn((updater: any) => {
    Object.assign(state, typeof updater === 'function' ? updater(state) : updater);
  });
  const updateMessage = (id: string, value: Partial<UIChatMessage>) => {
    for (const [key, messages] of Object.entries(state.dbMessagesMap)) {
      state.dbMessagesMap[key] = (messages as UIChatMessage[]).map((message) =>
        message.id === id ? { ...message, ...value } : message,
      );
    }
  };
  const actions = {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn((id: string) => {
      const op = state.operations[id];
      if (op && op.status !== 'cancelled') op.status = 'completed';
    }),
    connectToGateway: vi.fn(),
    drainQueuedMessages: vi.fn(() => []),
    failOperation: vi.fn(),
    internal_dispatchMessage: vi.fn((action: any) => {
      if (action.type === 'updateMessage') updateMessage(action.id, action.value);
    }),
    internal_dispatchTopic: vi.fn(),
    internal_replaceTopicId: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    markTopicUnread: vi.fn(),
    moveQueuedMessages: vi.fn(),
    moveVoiceMessages: vi.fn(),
    onOperationCancel: vi.fn(),
    refreshTopic: vi.fn().mockResolvedValue(undefined),
    refreshTopicDetail: vi.fn().mockResolvedValue(undefined),
    replaceMessages: vi.fn((messages: UIChatMessage[], params: { context: any }) => {
      state.dbMessagesMap[messageMapKey(params.context)] = messages;
    }),
    startOperation: vi.fn((params: any) => {
      const operationId = `local-op-${(opSeq += 1)}`;
      state.operations[operationId] = {
        abortController: new AbortController(),
        context: params.context,
        id: operationId,
        metadata: { startTime: Date.now(), ...params.metadata },
        status: 'running',
        type: params.type,
      };
      return { abortController: new AbortController(), operationId };
    }),
    switchTopic: vi.fn(),
    updateOperationMetadata: vi.fn(),
    updateTopicStatus: vi.fn().mockResolvedValue(undefined),
  };
  const get = vi.fn(() => Object.assign(state, actions)) as any;
  return { get, set, state };
};

/**
 * The wire order of a protocol v2 run stopped mid-answer: the step streams,
 * the user presses Stop (local op cancelled, `interruptTask` confirmed), and
 * the server's `interruptOperation` publishes the terminal frame as soon as it
 * saves `interrupted` — the in-flight step writes the partial text later, so
 * any DB read at that point still returns the placeholder.
 */
const sendStreamAndStop = async (params: {
  context: Record<string, any>;
  optimisticTopic?: { id: string; title: string };
  /** `false`: Stop lands before the step produced any output. */
  streams?: boolean;
  topicId: string;
}) => {
  const { get, set, state } = createConversationStore();
  (globalThis as any).window = {
    global_serverConfigStore: {
      getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
    },
  };
  const action = new GatewayActionImpl(set as any, get, undefined);
  const resolvedContext = { ...params.context, topicId: params.topicId };
  const key = messageMapKey(resolvedContext as any);
  // An existing topic already shows the turn; a new topic's bucket is seeded
  // from the server's rows right after the topic id handoff.
  if (!params.optimisticTopic) state.dbMessagesMap[key] = [user, placeholder];
  vi.mocked(messageService.getMessages).mockResolvedValue([user, placeholder]);
  vi.mocked(aiAgentService.execAgentTask).mockResolvedValue({
    ...serverResult,
    topicId: params.topicId,
  });
  vi.mocked(aiAgentService.interruptTask).mockResolvedValue({
    operationId: 'server-op',
    success: true,
  });

  await action.executeGatewayAgent({
    context: params.context as any,
    message: 'Count to four',
    optimisticTopic: params.optimisticTopic,
  });

  const [{ onEvent }] = state.connectToGateway.mock.calls.at(-1);
  const [localOpId, onCancel] = state.onOperationCancel.mock.calls.at(-1);

  if (params.streams !== false) {
    onEvent(event('step_start', { messageRevision: 0 }));
    onEvent(
      event('stream_start', {
        assistantMessage: { id: 'ast-1', parentId: 'usr-1', role: 'assistant' },
      }),
    );
    onEvent(event('stream_chunk', { chunkType: 'text', content: 'One two' }));
    onEvent(event('stream_chunk', { chunkType: 'text', content: ' three four' }));
    await flush();
  }
  const shownBeforeStop = state.dbMessagesMap[key]?.find((m: UIChatMessage) => m.id === 'ast-1');

  // Stop: `cancelOperation` flips the op and runs the transport's cancel hook.
  state.operations[localOpId].status = 'cancelled';
  await onCancel();
  vi.mocked(messageService.getMessages).mockClear();
  onEvent(
    event('agent_runtime_end', {
      messagePatchMode: true,
      messageRevision: 1,
      reason: 'interrupted',
    }),
  );
  await flush();

  const reply = state.dbMessagesMap[key]?.find((m: UIChatMessage) => m.id === 'ast-1');
  return { reply, shownBeforeStop };
};

describe('stopping a Gateway run while its reply streams', () => {
  const context = { agentId: 'agent-1', scope: 'main', threadId: null };

  // ROOT CAUSE:
  //
  // A v2 terminal frame carries `messagePatchMode` with a revision ahead of
  // the last patch (a Stop lands mid-step), and the handler checked that
  // branch before the mid-stream-interrupt one: it refetched the DB, which
  // still held the step's placeholder, and replaced the streamed reply. The
  // socket closes on that frame, so only a reload brought the text back.
  //
  // Before: the reply turned back into the empty placeholder after Stop.
  // After: the streamed text stays, matching what the server persists.
  it('keeps the streamed reply in an existing topic', async () => {
    const { reply, shownBeforeStop } = await sendStreamAndStop({
      context: { ...context, topicId: 'topic-1' },
      topicId: 'topic-1',
    });

    expect(shownBeforeStop?.content).toBe('One two three four');
    expect(reply?.content).toBe('One two three four');
    expect(messageService.getMessages).not.toHaveBeenCalled();
  });

  it('keeps the streamed reply of the first message in a new topic', async () => {
    const { reply, shownBeforeStop } = await sendStreamAndStop({
      context: { ...context, topicId: null },
      optimisticTopic: { id: 'tmp-topic', title: 'Count to four' },
      topicId: 'tpc_created',
    });

    expect(shownBeforeStop?.content).toBe('One two three four');
    expect(reply?.content).toBe('One two three four');
    expect(messageService.getMessages).not.toHaveBeenCalled();
  });

  // Nothing streamed yet: the optimistic rows are all the client has, so the
  // terminal frame still reconciles them with the server.
  it('still reconciles from the server when Stop lands before any output', async () => {
    const { reply } = await sendStreamAndStop({
      context: { ...context, topicId: 'topic-1' },
      streams: false,
      topicId: 'topic-1',
    });

    expect(messageService.getMessages).toHaveBeenCalled();
    expect(reply).toEqual(placeholder);
  });
});
