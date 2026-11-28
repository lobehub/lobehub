import type { AgentState } from '@lobechat/agent-runtime';
import * as agentRuntime from '@lobechat/agent-runtime';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as mecha from '@/services/chat/mecha';

import { useChatStore } from '../../../../store';
import {
  createMockAgentConfig,
  createMockChatConfig,
  createMockResolvedAgentConfig,
  TEST_IDS,
} from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({
    serverConfig: { enableMultimodalUnderstanding: false },
  }),
  serverConfigSelectors: {
    enableMcpApps: () => false,
    enableMultimodalUnderstanding: () => false,
  },
}));

const realExecAgentRuntime = useChatStore.getState().executeClientAgent;

const createCompletedRuntimeState = (operationId: string): AgentState => ({
  cost: {
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  },
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  maxSteps: 10,
  messages: [],
  operationId,
  status: 'done',
  stepCount: 1,
  toolManifestMap: {},
  usage: {
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: { apiCalls: 1, processingTimeMs: 100, tokens: { input: 10, output: 20, total: 30 } },
    tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
  },
  userInterventionConfig: { allowList: [], approvalMode: 'manual' },
});

describe('executeClientAgent context budget configuration', () => {
  beforeEach(() => {
    resetTestEnvironment();
    setupMockSelectors();
    spyOnMessageService();
    act(() => {
      useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
    });
  });

  it('passes resolved agentConfig.systemRole and includeReasoning=shouldReplayAssistantReasoning into GeneralChatAgent', async () => {
    const { result } = renderHook(() => useChatStore());

    let operationId!: string;
    act(() => {
      operationId = result.current.startOperation({
        context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        type: 'execAgentRuntime',
      }).operationId;
    });

    const longSystemRole = 'System prompt instruction. '.repeat(200);
    vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
      agentConfig: {
        ...createMockResolvedAgentConfig(),
        agentConfig: createMockAgentConfig({
          model: 'gpt-4o-mini',
          provider: 'openai',
          systemRole: longSystemRole,
        }),
        chatConfig: createMockChatConfig({ enableContextCompression: true }),
      },
      context: {
        payload: {},
        phase: 'init',
        session: {
          messageCount: 0,
          sessionId: TEST_IDS.SESSION_ID,
          status: 'done',
          stepCount: 1,
        },
      },
      state: createCompletedRuntimeState(operationId),
    });

    vi.spyOn(mecha, 'resolveBrowserModelParams').mockResolvedValue({
      shouldReplayAssistantReasoning: false,
    } as any);

    const generalAgentSpy = vi.spyOn(agentRuntime, 'GeneralChatAgent');

    await act(async () => {
      await result.current.executeClientAgent({
        context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        messages: [],
        operationId,
        parentMessageId: TEST_IDS.USER_MESSAGE_ID,
        parentMessageType: 'user',
      });
    });

    expect(generalAgentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          maxSteps: 1000,
          systemRole: longSystemRole,
        }),
        compressionConfig: expect.objectContaining({
          enabled: true,
          includeReasoning: false,
        }),
      }),
    );
  });
});
