/** Claude Code's native next-prompt suggestion, from spawn flag to follow-up chip. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { followUpActionSelectors, useFollowUpActionStore } from '@/store/followUpAction';

import { executeHeterogeneousAgent } from '../transports/hetero/heterogeneousAgentExecutor';
import {
  ccInit,
  ccResult,
  ccText,
  createMockStore,
  defaultContext,
  defaultParams,
  setupIpcCapture,
} from './heterogeneousAgentExecutor.testUtils';

const mockSendPrompt = vi.fn();
const mockStartSession = vi.fn();

vi.mock('@/services/message', () => ({
  messageService: {
    batchMutate: vi.fn(async (operations: any[]) => ({
      results: operations.map((operation, index) => ({ index, success: true, ...operation })),
      success: true,
    })),
    createMessage: vi.fn(async (params: any) => ({ id: params.id })),
    getMessages: vi.fn(async () => []),
    updateMessage: vi.fn(async () => undefined),
    updateMessageError: vi.fn(async () => ({ success: true })),
    updateToolMessage: vi.fn(async () => undefined),
  },
}));

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    cancelSession: vi.fn(async () => undefined),
    getClaudeCodeIdentity: vi.fn(async () => null),
    getCodexQuota: vi.fn(async () => null),
    getSessionInfo: vi.fn(async () => ({})),
    sendPrompt: (...args: any[]) => mockSendPrompt(...args),
    startSession: (...args: any[]) => mockStartSession(...args),
    stopSession: vi.fn(async () => undefined),
  },
}));

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    beginLocalHeteroRunFee: vi.fn(async () => ({ feeId: 'fee-1' })),
    finishLocalHeteroRunFee: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock('@/services/agentQuota', () => ({
  agentQuotaService: {
    recordUsage: vi.fn(async () => undefined),
    selectAccountForAgent: vi.fn(async () => null),
  },
}));

vi.mock('../transports/gateway/gatewayEventHandler', () => ({
  createGatewayEventHandler: vi.fn(() => vi.fn()),
}));

const KEY = messageMapKey(defaultContext);
const SUGGESTION = 'Now run the tests';

const chips = () =>
  followUpActionSelectors.chipsFor({
    conversationKey: KEY,
    messageId: defaultParams.assistantMessageId,
  })(useFollowUpActionStore.getState());

const setFollowUpEnabled = (enableFollowUpChips: boolean) =>
  useAgentStore.setState({
    agentMap: { [defaultContext.agentId]: { chatConfig: { enableFollowUpChips } } },
  } as any);

describe('heterogeneousAgentExecutor prompt suggestions', () => {
  let ipc: ReturnType<typeof setupIpcCapture>;

  beforeEach(() => {
    vi.clearAllMocks();
    ipc = setupIpcCapture();
    useFollowUpActionStore.getState().clear(KEY);
    setFollowUpEnabled(true);
    mockStartSession.mockResolvedValue({ sessionId: 'ipc-sess-1' });
    mockSendPrompt.mockImplementation(async ({ sessionId }: any) => {
      ipc.emitRawLine(sessionId, ccInit());
      ipc.emitRawLine(sessionId, ccText('msg-1', 'done'));
      ipc.emitRawLine(sessionId, ccResult());
      ipc.emitRawLine(sessionId, { suggestion: SUGGESTION, type: 'prompt_suggestion' });
      ipc.emitComplete(sessionId);
    });
  });

  it('asks for suggestions and shows the one that arrives after the result', async () => {
    const store = createMockStore({
      dbMessagesMap: { [KEY]: [{ id: defaultParams.assistantMessageId, role: 'assistant' }] },
    });

    await executeHeterogeneousAgent(() => store, defaultParams);

    expect(mockStartSession.mock.calls[0][0].args).toContain('--prompt-suggestions=true');
    expect(chips()).toEqual([{ label: SUGGESTION, message: SUGGESTION }]);
  });

  it('does not ask for suggestions when the agent has them off', async () => {
    setFollowUpEnabled(false);

    await executeHeterogeneousAgent(() => createMockStore(), defaultParams);

    expect(mockStartSession.mock.calls[0][0].args ?? []).not.toContain('--prompt-suggestions=true');
  });

  it('drops the suggestion when the user already sent the next message', async () => {
    const store = createMockStore({
      dbMessagesMap: {
        [KEY]: [
          { id: defaultParams.assistantMessageId, role: 'assistant' },
          { id: 'msg-next', role: 'user' },
        ],
      },
    });

    await executeHeterogeneousAgent(() => store, defaultParams);

    expect(chips()).toEqual([]);
  });
});
