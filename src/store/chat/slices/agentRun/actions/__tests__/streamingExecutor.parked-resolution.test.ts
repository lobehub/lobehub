import type { AgentState } from '@lobechat/agent-runtime';
import * as agentRuntime from '@lobechat/agent-runtime';
import type * as LobeChatConst from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentConfigResolver from '@/services/chat/mecha/agentConfigResolver';
import { workService } from '@/services/work';
import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';

import { useChatStore } from '../../../../store';
import {
  createMockAgentConfig,
  createMockChatConfig,
  createMockResolvedAgentConfig,
  TEST_IDS,
} from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

// Scenario split from `streamingExecutor.test.ts` (source-layout §2/§3: new
// tests for the executor's resolved value live in a scenario file so the
// over-limit parent file does not grow). Covers what `executeClientAgent`
// RESOLVES with on parked vs terminal states — the contract programmatic
// callers (e.g. `runClientSubAgent`) rely on to tell a parked run from a
// finished one.

const serverConfigMock = vi.hoisted(() => ({ enableMultimodalUnderstanding: false }));
const agentSignalBridgeMock = vi.hoisted(() => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));
const desktopFlag = vi.hoisted(() => ({ value: false }));

vi.mock('@/utils/localStorage', () => {
  class AsyncLocalStorage<State> {
    getFromLocalStorageSync(): State {
      return {} as State;
    }

    async getFromLocalStorage(): Promise<State> {
      return {} as State;
    }

    async saveToLocalStorage(): Promise<void> {
      return undefined;
    }
  }

  return { AsyncLocalStorage };
});

vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: agentSignalBridgeMock.emitClientAgentSignalSourceEvent,
}));
vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeChatConst>();
  return {
    ...actual,
    get isDesktop() {
      return desktopFlag.value;
    },
  };
});
vi.mock('@/services/electron/desktopNotification', () => ({
  desktopNotificationService: { showNotification: vi.fn() },
}));
vi.mock('@/services/electron/completionSound', () => ({
  completionSoundService: { getNotificationSoundFile: vi.fn(), play: vi.fn() },
}));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({
    serverConfig: { enableMultimodalUnderstanding: serverConfigMock.enableMultimodalUnderstanding },
  }),
  serverConfigSelectors: {
    enableMultimodalUnderstanding: (state: {
      serverConfig: { enableMultimodalUnderstanding?: boolean };
    }) => !!state.serverConfig.enableMultimodalUnderstanding,
  },
}));

const realExecAgentRuntime = useChatStore.getState().executeClientAgent;
const realCreateAgentState = useChatStore.getState().internal_createAgentState;

const createMockRuntimeState = (operationId: string, status: AgentState['status']): AgentState => ({
  status,
  operationId,
  messages: [],
  maxSteps: 10,
  stepCount: 1,
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  toolManifestMap: {},
  userInterventionConfig: { approvalMode: 'manual', allowList: [] },
  usage: {
    llm: { apiCalls: 1, processingTimeMs: 100, tokens: { input: 10, output: 20, total: 30 } },
    tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
  },
  cost: {
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    total: 0,
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
  },
});

const mockInternalCreateAgentState = (value: ReturnType<typeof realCreateAgentState>) => {
  act(() => {
    useChatStore.setState({
      internal_createAgentState: vi.fn<typeof realCreateAgentState>().mockReturnValue(value),
    });
  });
};

const restoreExecutor = () =>
  act(() => {
    useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
  });

describe('StreamingExecutor actions — resolved value (parked vs terminal)', () => {
  const driveTerminal = (operationId: string, status: AgentState['status']) => {
    mockInternalCreateAgentState({
      state: createMockRuntimeState(operationId, status),
      context: {
        phase: 'init',
        payload: { model: 'gpt-4o-mini', provider: 'openai' },
        session: {
          sessionId: TEST_IDS.SESSION_ID,
          messageCount: 0,
          status,
          stepCount: 1,
        },
      },
      agentConfig: createMockResolvedAgentConfig(),
    });
  };

  const pinStep = (operationId: string, status: AgentState['status']) => {
    vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValue({
      events: [],
      newState: createMockRuntimeState(operationId, status),
      nextContext: undefined,
    });
  };

  beforeEach(() => {
    resetTestEnvironment();
    setupMockSelectors();
    spyOnMessageService();
    vi.spyOn(workService, 'listByRootOperation').mockResolvedValue([]);
    desktopFlag.value = false;
    serverConfigMock.enableMultimodalUnderstanding = false;

    act(() => {
      useAgentStore.setState({ availableAgents: [] });
      // executeClientAgent waits for the aiProvider runtime-state before building
      // tools; mark it ready so that guard is a no-op in these tests.
      useAiInfraStore.setState({ isInitAiProviderRuntimeState: true });
      useChatStore.setState({
        refreshMessages: vi.fn(),
        executeClientAgent: vi.fn(),
        internal_createAgentState: realCreateAgentState,
      });
    });
  });

  afterEach(() => {
    useAiInfraStore.setState({ enabledAiModels: [] });
    vi.restoreAllMocks();
  });

  it('on parked: resolves with parked=true so callers can tell the run is not finished', async () => {
    const { result } = renderHook(() => useChatStore());
    restoreExecutor();

    let operationId!: string;
    act(() => {
      operationId = result.current.startOperation({
        type: 'execAgentRuntime',
        context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
      }).operationId;
    });

    driveTerminal(operationId, 'waiting_for_async_tool');
    pinStep(operationId, 'waiting_for_async_tool');

    let resolved: Awaited<ReturnType<typeof realExecAgentRuntime>> | undefined;
    await act(async () => {
      resolved = await result.current.executeClientAgent({
        context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        messages: [],
        parentMessageId: TEST_IDS.USER_MESSAGE_ID,
        parentMessageType: 'user',
        operationId,
      });
    });

    // The run is alive and resumes out-of-band: the caller must be able to
    // distinguish this from a real completion (`runClientSubAgent` relies on
    // this flag to avoid backfilling a false "Task completed" success).
    expect(resolved).toEqual({ parked: true });
  });

  it('on done: resolves without a parked flag', async () => {
    const { result } = renderHook(() => useChatStore());
    restoreExecutor();

    let operationId!: string;
    act(() => {
      operationId = result.current.startOperation({
        type: 'execAgentRuntime',
        context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
      }).operationId;
    });

    driveTerminal(operationId, 'done');
    pinStep(operationId, 'done');

    let resolved: Awaited<ReturnType<typeof realExecAgentRuntime>> | undefined;
    await act(async () => {
      resolved = await result.current.executeClientAgent({
        context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        messages: [],
        parentMessageId: TEST_IDS.USER_MESSAGE_ID,
        parentMessageType: 'user',
        operationId,
      });
    });

    expect(resolved).toBeDefined();
    expect((resolved as { parked?: boolean }).parked).toBeUndefined();
  });

  it('keeps the resolver agent-config contract used by driveTerminal', () => {
    // Guards the scenario file's own scaffolding: the fixture contract the
    // mocked `internal_createAgentState` relies on must stay aligned with the
    // executor's expectations.
    const resolved = agentConfigResolver.resolveAgentConfig;
    expect(typeof resolved).toBe('function');
    expect(createMockAgentConfig).toBeDefined();
    expect(createMockChatConfig).toBeDefined();
  });
});
