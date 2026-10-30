import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { aiAgentService } from '@/services/aiAgent';
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
  labPreferSelectors: { enableGatewayMux: () => false },
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

/** A workspace topic another member's run still holds, opened in this tab. */
const createHarness = () => {
  const connectToGateway = vi.fn();
  const completeOperation = vi.fn();
  const internalDispatchTopic = vi.fn();
  const state: Record<string, any> = {
    activeAgentId: 'agent-1',
    activeTopicId: 'topic-1',
    gatewayConnections: {},
    messagesMap: {},
    topicDataMap: {
      'agent_agent-1': {
        items: [
          {
            id: 'topic-1',
            metadata: {
              runningOperation: { assistantMessageId: 'ast-1', operationId: 'teammate-op' },
            },
          },
        ],
      },
    },
  };
  const get = vi.fn(() => ({
    ...state,
    associateMessageWithOperation: vi.fn(),
    completeOperation,
    connectToGateway,
    internal_dispatchTopic: internalDispatchTopic,
    internal_pinTopicStatus: vi.fn(),
    onOperationCancel: vi.fn(),
    startOperation: vi.fn(() => ({ operationId: 'gw-op-reconnect' })),
  })) as any;

  (globalThis as any).window = {
    global_serverConfigStore: {
      getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
    },
  };

  const action = new GatewayActionImpl(vi.fn() as any, get, undefined);
  return { action, completeOperation, connectToGateway, internalDispatchTopic };
};

describe("reconnecting to a workspace teammate's run", () => {
  // Regression (T-1102): the server signed a token the gateway refused, the
  // auth_failed close was read as a dead run, the tab cleared the marker and
  // settled the teammate's run, and the next topic refresh brought the marker
  // back — reconnecting forever. The server now answers FORBIDDEN instead.
  it('keeps the marker, retires the local op and does not connect or settle', async () => {
    const { action, completeOperation, connectToGateway, internalDispatchTopic } = createHarness();
    vi.mocked(aiAgentService.refreshGatewayToken).mockRejectedValueOnce({
      data: { code: 'FORBIDDEN' },
    });

    await expect(
      action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'teammate-op',
        topicId: 'topic-1',
      }),
    ).resolves.toBeUndefined();

    expect(completeOperation).toHaveBeenCalledWith('gw-op-reconnect');
    expect(internalDispatchTopic).not.toHaveBeenCalled();
    expect(connectToGateway).not.toHaveBeenCalled();
    expect(topicService.settleRunningOperation).not.toHaveBeenCalled();
  });
});
