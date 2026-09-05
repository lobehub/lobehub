import type { AgentState, CallLLMPayload } from '@lobechat/agent-runtime';
import type { ResolvedToolSet } from '@lobechat/context-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { buildServerCallLlmContext } from './serverCallLlmContextBuilder';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

const getInfoForAIGenerationMock = vi.hoisted(() => vi.fn());
const getUserSettingsMock = vi.hoisted(() => vi.fn());
const resolveServerCallLlmContextHintsMock = vi.hoisted(() => vi.fn());
const serverMessagesEngineMock = vi.hoisted(() => vi.fn());
const marketCredsListMock = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    static getInfoForAIGeneration = getInfoForAIGenerationMock;
    getUserSettings = getUserSettingsMock;
  },
}));

vi.mock('@/server/services/market', () => ({
  MarketService: class {
    market = {
      creds: { list: marketCredsListMock },
      organizations: { creds: () => ({ list: marketCredsListMock }) },
    };
  },
}));

vi.mock('@/config/composio', () => ({
  composioEnv: { COMPOSIO_API_KEY: undefined },
}));

vi.mock('./serverCallLlmContextHints', () => ({
  resolveServerCallLlmContextHints: resolveServerCallLlmContextHintsMock,
}));

vi.mock('@/server/modules/Mecha/ContextEngineering', () => ({
  serverMessagesEngine: serverMessagesEngineMock,
}));

const createCtx = (overrides: Partial<RuntimeExecutorContext> = {}): RuntimeExecutorContext =>
  ({
    agentConfig: { chatConfig: {}, files: [], knowledgeBases: [] } as any,
    messageModel: {} as RuntimeExecutorContext['messageModel'],
    operationId: 'operation-1',
    serverDB: {} as RuntimeExecutorContext['serverDB'],
    stepIndex: 0,
    streamManager: {} as RuntimeExecutorContext['streamManager'],
    toolExecutionService: {} as RuntimeExecutorContext['toolExecutionService'],
    userId: 'creator-1',
    ...overrides,
  }) satisfies RuntimeExecutorContext;

const llmPayload = { messages: [] } as unknown as CallLLMPayload;
const state = { metadata: {} } as unknown as AgentState;
const tooling = {
  resolved: {
    enabledToolIds: [],
    manifestMap: {},
    promptManifestMap: {},
    sourceMap: {},
    tools: [],
  } as ResolvedToolSet,
} as unknown as ServerCallLlmTooling;

beforeEach(() => {
  vi.clearAllMocks();

  getInfoForAIGenerationMock.mockResolvedValue({
    responseLanguage: 'en-US',
    userName: 'Some Name',
  });
  getUserSettingsMock.mockResolvedValue({});
  marketCredsListMock.mockResolvedValue({ data: [] });
  serverMessagesEngineMock.mockResolvedValue([]);
  resolveServerCallLlmContextHintsMock.mockResolvedValue({
    capabilities: {
      isCanUseAudio: () => false,
      isCanUseFC: () => false,
      isCanUseVideo: () => false,
      isCanUseVision: () => false,
    },
    messagesForContext: [],
    shouldReplayAssistantReasoning: false,
  });
});

describe('buildServerCallLlmContext - {{username}}/{{language}} placeholder source', () => {
  it('resolves user info from the creator when the run is not a share-visitor run', async () => {
    await buildServerCallLlmContext({
      ctx: createCtx(),
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
      state,
      tooling,
    });

    expect(getInfoForAIGenerationMock).toHaveBeenCalledWith(expect.anything(), 'creator-1');
  });

  it('resolves user info from the VISITOR, not the creator, on a share-visitor run', async () => {
    await buildServerCallLlmContext({
      ctx: createCtx({
        agentShareVisitor: {
          agentId: 'agent-1',
          shareId: 'share-1',
          visitorUserId: 'visitor-1',
        },
      }),
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
      state,
      tooling,
    });

    expect(getInfoForAIGenerationMock).toHaveBeenCalledWith(expect.anything(), 'visitor-1');
    expect(getInfoForAIGenerationMock).not.toHaveBeenCalledWith(expect.anything(), 'creator-1');
  });
});
