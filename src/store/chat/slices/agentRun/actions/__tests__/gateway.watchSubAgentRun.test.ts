import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { topicService } from '@/services/topic';

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
  shareChatService: { interruptTask: vi.fn(), refreshGatewayToken: vi.fn() },
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
  getFileStoreState: () => ({ moveChatContextSelections: vi.fn() }),
}));

const mockUserState = vi.hoisted(() => ({
  profile: { id: 'user-viewer' },
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

const createMockClient = () => ({ disconnect: vi.fn() });

describe('GatewayActionImpl.watchSubAgentRun', () => {
  const threadContext = {
    agentId: 'agt-expert',
    scope: 'thread' as const,
    threadId: 'thd-1',
    topicId: 'tpc-1',
  };

  function createWatchTestAction() {
    const connectToGateway = vi.fn();
    const completeOperation = vi.fn();
    const operations: Record<string, any> = {};
    const state: Record<string, any> = { gatewayConnections: {}, operations };
    const get = vi.fn(() => ({
      ...state,
      associateMessageWithOperation: vi.fn(),
      completeOperation: (id: string) => {
        completeOperation(id);
        operations[id].status = 'completed';
      },
      connectToGateway,
      startOperation: vi.fn(() => {
        operations['watch-op'] = { status: 'running' };
        return { operationId: 'watch-op' };
      }),
    })) as any;
    const set = vi.fn((updater: any) => {
      if (typeof updater === 'function') Object.assign(state, updater(state));
      else Object.assign(state, updater);
    });

    (globalThis as any).window = {
      global_serverConfigStore: {
        getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
      },
    };

    const action = new GatewayActionImpl(set as any, get, undefined);
    return { action, completeOperation, connectToGateway, state };
  }

  const watch = (action: GatewayActionImpl) =>
    action.watchSubAgentRun({
      assistantMessageId: 'msg-child',
      context: threadContext,
      operationId: 'op-child',
      token: 'child-ticket',
    });

  it('subscribes passively to the child run with its own ticket, replaying what it missed', () => {
    const { action, connectToGateway } = createWatchTestAction();

    watch(action);

    expect(connectToGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: false,
        gatewayUrl: 'https://gateway.test.com',
        localOperationId: 'watch-op',
        operationId: 'op-child',
        resumeOnConnect: true,
        token: 'child-ticket',
        topicId: 'tpc-1',
      }),
    );
  });

  it('settles only its own render operation when the stream ends, never the topic', () => {
    const { action, completeOperation, connectToGateway } = createWatchTestAction();

    watch(action);
    connectToGateway.mock.calls[0][0].onSessionComplete({
      authFailed: false,
      succeeded: true,
      terminalReceived: true,
    });

    expect(completeOperation).toHaveBeenCalledWith('watch-op');
    expect(topicService.settleRunningOperation).not.toHaveBeenCalled();
  });

  it('drops the subscription and its operation when the caller stops watching', () => {
    const { action, completeOperation, state } = createWatchTestAction();
    const client = createMockClient();
    state.gatewayConnections['op-child'] = { client, status: 'connected' };

    const stop = watch(action);
    stop();

    expect(client.disconnect).toHaveBeenCalled();
    expect(completeOperation).toHaveBeenCalledWith('watch-op');
  });

  it('does nothing without a gateway', () => {
    const { action, connectToGateway } = createWatchTestAction();
    (globalThis as any).window = undefined;

    watch(action)();

    expect(connectToGateway).not.toHaveBeenCalled();
  });
});
