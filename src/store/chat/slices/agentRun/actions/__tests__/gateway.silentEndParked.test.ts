import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { aiAgentService } from '@/services/aiAgent';
import { topicService } from '@/services/topic';

import { GatewayActionImpl } from '../transports/gateway/gateway';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execAgentTask: vi.fn(),
    getOperationStatus: vi.fn(),
    interruptTask: vi.fn(),
    refreshGatewayToken: vi.fn(),
  },
}));

vi.mock('@/services/shareChat', () => ({
  shareChatService: { getTopics: vi.fn(), interruptTask: vi.fn(), refreshGatewayToken: vi.fn() },
}));

vi.mock('@/services/message', () => ({
  messageService: { getMessages: vi.fn().mockResolvedValue([]) },
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

vi.mock('@/store/user', () => ({ useUserStore: { getState: vi.fn(() => mockUserState) } }));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: { defaultAgentConfig: () => ({ chatConfig: {} }) },
  toolInterventionSelectors: { allowList: () => [], approvalMode: () => 'manual' },
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

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as any).window;
});

const MARKER = { assistantMessageId: 'ast-1', operationId: 'server-op-1' };

/** A tab reconnected to a run whose topic the server still reserves for it. */
const reconnectAndCaptureSilentEnd = async () => {
  const captured: { onSilentEnd?: () => boolean | Promise<boolean> } = {};
  const state: Record<string, any> = {
    activeAgentId: 'agent-1',
    activeTopicId: 'topic-1',
    gatewayConnections: {},
    messagesMap: {},
    topicDataMap: {
      'agent_agent-1': { items: [{ id: 'topic-1', metadata: { runningOperation: MARKER } }] },
    },
  };
  const get = vi.fn(() => ({
    ...state,
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    connectToGateway: vi.fn((params: any) => {
      captured.onSilentEnd = params.onSilentEnd;
    }),
    internal_dispatchTopic: vi.fn(),
    onOperationCancel: vi.fn(),
    startOperation: vi.fn(() => ({ operationId: 'gw-op-reconnect' })),
    updateTopicStatus: vi.fn(),
  })) as any;

  (globalThis as any).window = {
    global_serverConfigStore: {
      getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
    },
  };
  vi.mocked(aiAgentService.refreshGatewayToken).mockResolvedValue({ token: 't' } as any);
  vi.mocked(topicService.getTopicDetail).mockResolvedValue({
    id: 'topic-1',
    metadata: { runningOperation: MARKER },
  } as never);

  const action = new GatewayActionImpl(vi.fn() as any, get, undefined);
  await action.reconnectToGatewayOperation({
    assistantMessageId: 'ast-1',
    heteroType: null,
    operationId: 'server-op-1',
    topicId: 'topic-1',
  });

  return () => captured.onSilentEnd!();
};

const operationStatus = (status: string) =>
  ({ currentState: { status }, operationId: 'server-op-1' }) as any;

describe('silent end of a run parked on a human answer', () => {
  // Regression (lobehub#23933): the desktop app missed the park's terminal frame,
  // and the reconcile read the still-present topic marker as "alive". The local op
  // stayed running, the transcript never refetched, and the askUserQuestion card
  // never appeared while a fresh web tab showed it at once.
  it('ends the subscription so the question card is fetched', async () => {
    const readSilentEnd = await reconnectAndCaptureSilentEnd();
    vi.mocked(aiAgentService.getOperationStatus).mockResolvedValue(
      operationStatus('waiting_for_human'),
    );

    await expect(readSilentEnd()).resolves.toBe(true);
    expect(aiAgentService.getOperationStatus).toHaveBeenCalledWith({
      operationId: 'server-op-1',
    });
  });

  it('keeps waiting while the run is still running', async () => {
    const readSilentEnd = await reconnectAndCaptureSilentEnd();
    vi.mocked(aiAgentService.getOperationStatus).mockResolvedValue(operationStatus('running'));

    await expect(readSilentEnd()).resolves.toBe(false);
  });

  // Deferred async tools resume the SAME operation id, so its stream is not over.
  it('keeps waiting while the run waits for an async tool', async () => {
    const readSilentEnd = await reconnectAndCaptureSilentEnd();
    vi.mocked(aiAgentService.getOperationStatus).mockResolvedValue(
      operationStatus('waiting_for_async_tool'),
    );

    await expect(readSilentEnd()).resolves.toBe(false);
  });

  it('keeps waiting when the operation status cannot be read', async () => {
    const readSilentEnd = await reconnectAndCaptureSilentEnd();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(aiAgentService.getOperationStatus).mockRejectedValueOnce(new Error('offline'));

    await expect(readSilentEnd()).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });
});
