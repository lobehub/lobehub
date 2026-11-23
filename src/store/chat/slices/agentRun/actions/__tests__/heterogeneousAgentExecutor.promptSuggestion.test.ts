/** Claude Code's native next-prompt suggestion, from spawn flag to follow-up chip. */

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { followUpActionService } from '@/services/followUpAction';
import { useAgentStore } from '@/store/agent';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { followUpActionSelectors, useFollowUpActionStore } from '@/store/followUpAction';
import { systemAgentSelectors } from '@/store/user/slices/settings/selectors/systemAgent';

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

  it('clears the previous native chip before a run that produces none', async () => {
    useFollowUpActionStore
      .getState()
      .setNativeSuggestion(KEY, { messageId: defaultParams.assistantMessageId, suggestion: 'old' });
    mockSendPrompt.mockImplementation(async ({ sessionId }: any) => {
      ipc.emitRawLine(sessionId, ccInit());
      ipc.emitRawLine(sessionId, ccText('msg-1', 'done'));
      ipc.emitRawLine(sessionId, ccResult());
      ipc.emitComplete(sessionId);
    });

    await executeHeterogeneousAgent(() => createMockStore(), defaultParams);

    expect(followUpActionSelectors.slotStatus(KEY)(useFollowUpActionStore.getState())).toBe('idle');
  });

  describe('server extraction fallback', () => {
    const replyOnly = async ({ sessionId }: any) => {
      ipc.emitRawLine(sessionId, ccInit());
      ipc.emitRawLine(sessionId, ccText('msg-1', 'done'));
      ipc.emitRawLine(sessionId, ccResult());
      ipc.emitComplete(sessionId);
    };
    const storeWithReply = () =>
      createMockStore({
        dbMessagesMap: { [KEY]: [{ id: defaultParams.assistantMessageId, role: 'assistant' }] },
      });
    let extract: MockInstance<typeof followUpActionService.extract>;
    let followUpConfig: MockInstance<typeof systemAgentSelectors.followUpAction>;

    beforeEach(() => {
      extract = vi
        .spyOn(followUpActionService, 'extract')
        .mockResolvedValue({ chips: [], messageId: '' });
      followUpConfig = vi.spyOn(systemAgentSelectors, 'followUpAction').mockReturnValue({
        enabled: true,
        model: 'follow-up-model',
        provider: 'follow-up-provider',
      } as any);
    });

    afterEach(() => {
      extract.mockRestore();
      followUpConfig.mockRestore();
    });

    it('extracts when the CLI ended the run without a suggestion', async () => {
      mockSendPrompt.mockImplementation(replyOnly);

      await executeHeterogeneousAgent(() => storeWithReply(), defaultParams);

      expect(extract).toHaveBeenCalledOnce();
    });

    it('does not extract when the native suggestion landed', async () => {
      await executeHeterogeneousAgent(() => storeWithReply(), defaultParams);

      expect(extract).not.toHaveBeenCalled();
      expect(chips()).toEqual([{ label: SUGGESTION, message: SUGGESTION }]);
    });

    it('does not extract once the user has sent the next message', async () => {
      mockSendPrompt.mockImplementation(replyOnly);
      const store = createMockStore({
        dbMessagesMap: {
          [KEY]: [
            { id: defaultParams.assistantMessageId, role: 'assistant' },
            { id: 'msg-next', role: 'user' },
          ],
        },
      });

      await executeHeterogeneousAgent(() => store, defaultParams);

      expect(extract).not.toHaveBeenCalled();
    });

    it('does not extract when the agent has follow-ups off', async () => {
      setFollowUpEnabled(false);
      mockSendPrompt.mockImplementation(replyOnly);

      await executeHeterogeneousAgent(() => storeWithReply(), defaultParams);

      expect(extract).not.toHaveBeenCalled();
    });
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
