import type { AgentState, CallLLMPayload } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOwnerPrincipal, resolveRunPrincipal } from '@/server/services/executionPrincipal';

import type { RuntimeExecutorContext } from '../context';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

const topicFindByIdMock = vi.hoisted(() => vi.fn());
const messageQueryMock = vi.hoisted(() => vi.fn());
const getAgentContextDocumentsMock = vi.hoisted(() => vi.fn());
const serverMessagesEngineMock = vi.hoisted(() => vi.fn());
const getInfoForAIGenerationMock = vi.hoisted(() => vi.fn());
const getUserSettingsMock = vi.hoisted(() => vi.fn());
const credsListMock = vi.hoisted(() => vi.fn());

vi.mock('@/config/composio', () => ({
  composioEnv: { COMPOSIO_API_KEY: undefined },
}));

vi.mock('@/envs/file', () => ({
  fileEnv: { NEXT_PUBLIC_S3_FILE_PATH: 'files' },
}));

vi.mock('./serverCallLlmContextHints', () => ({
  resolveServerCallLlmContextHints: vi.fn().mockImplementation(async ({ llmPayload }) => ({
    capabilities: {
      isCanUseAudio: () => false,
      isCanUseFC: () => true,
      isCanUseVideo: () => false,
      isCanUseVision: () => false,
    },
    messagesForContext: llmPayload.messages,
    modelDisplayName: undefined,
    modelKnowledgeCutoff: undefined,
    preserveThinkingForPayload: undefined,
    resolvedExtendParams: undefined,
    shouldReplayAssistantReasoning: false,
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    findById: topicFindByIdMock,
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    query: messageQueryMock,
  })),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn().mockImplementation(() => ({
    getAgentContextDocuments: getAgentContextDocumentsMock,
    getDocumentByFilename: vi.fn(),
  })),
}));

vi.mock('@/database/models/user', () => {
  const UserModel = vi.fn().mockImplementation(() => ({
    getUserSettings: getUserSettingsMock,
  })) as any;
  UserModel.getInfoForAIGeneration = getInfoForAIGenerationMock;
  return { UserModel };
});

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    market: {
      creds: { list: credsListMock },
      organizations: {
        creds: vi.fn().mockReturnValue({ list: credsListMock }),
      },
    },
  })),
}));

vi.mock('@/server/modules/Mecha/ContextEngineering', () => ({
  serverMessagesEngine: serverMessagesEngineMock,
}));

const onboardingGetStateMock = vi.hoisted(() => vi.fn());
const onboardingGetInboxAgentIdMock = vi.hoisted(() => vi.fn());
const onboardingGetInitialUserInfoMock = vi.hoisted(() => vi.fn());
const getLatestPersonaDocumentMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/onboarding', () => ({
  OnboardingService: vi.fn().mockImplementation(() => ({
    getInboxAgentId: onboardingGetInboxAgentIdMock,
    getInitialUserInfo: onboardingGetInitialUserInfoMock,
    getState: onboardingGetStateMock,
  })),
}));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn().mockImplementation(() => ({
    getLatestPersonaDocument: getLatestPersonaDocumentMock,
  })),
}));

// Imported after the mocks above so the module under test picks them up.
const { buildServerCallLlmContext } = await import('./serverCallLlmContextBuilder');

const CREATOR_USER_ID = 'creator-1';
const VISITOR_USER_ID = 'visitor-1';
const AGENT_ID = 'agent-1';

const baseCtx = (overrides: Partial<RuntimeExecutorContext> = {}): RuntimeExecutorContext =>
  ({
    agentConfig: { chatConfig: {}, systemRole: 'test' },
    messageModel: {} as RuntimeExecutorContext['messageModel'],
    operationId: 'operation-1',
    serverDB: {} as RuntimeExecutorContext['serverDB'],
    stepIndex: 0,
    streamManager: {} as RuntimeExecutorContext['streamManager'],
    toolExecutionService: {} as RuntimeExecutorContext['toolExecutionService'],
    principal: createOwnerPrincipal(CREATOR_USER_ID),
    ...overrides,
  }) as RuntimeExecutorContext;

const baseState = (metadata: Record<string, unknown> = {}): AgentState =>
  ({
    cost: {} as any,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    maxSteps: 10,
    messages: [],
    metadata: { agentId: AGENT_ID, ...metadata },
    operationId: 'operation-1',
    status: 'idle',
    stepCount: 0,
  }) as unknown as AgentState;

const emptyTooling: ServerCallLlmTooling = {
  resolved: {
    activatableToolIds: [],
    enabledToolIds: [],
    promptManifestMap: {},
    tools: [],
  } as any,
  resolvedSkills: undefined,
  toolDiscoveryConfig: undefined,
  tools: undefined,
};

const buildPayload = (content: string): CallLLMPayload =>
  ({
    messages: [{ content, role: 'user' }],
  }) as unknown as CallLLMPayload;

beforeEach(() => {
  vi.clearAllMocks();

  serverMessagesEngineMock.mockImplementation(async (input: any) => input.messages);
  getInfoForAIGenerationMock.mockResolvedValue({ responseLanguage: 'en-US', userName: 'tester' });
  getUserSettingsMock.mockResolvedValue({});
  credsListMock.mockResolvedValue({ data: [] });
  getAgentContextDocumentsMock.mockResolvedValue([]);
  messageQueryMock.mockResolvedValue([]);
  onboardingGetStateMock.mockResolvedValue({
    discoveryUserMessageCount: 1,
    phase: 'discovery',
    remainingDiscoveryExchanges: 2,
  });
  onboardingGetInboxAgentIdMock.mockResolvedValue(null);
  onboardingGetInitialUserInfoMock.mockResolvedValue(undefined);
  getLatestPersonaDocumentMock.mockResolvedValue({ persona: 'Creator persona' });
});

// The topic lookup is ACTOR-scoped (see `serverCallLlmContextBuilder.ts`), so
// on a share run it already can only reach the visitor's own rows. What these
// cases pin down is the SECOND half of the gate: a referenced topic must also
// carry this run's `agentId` + `shareId`, so a visitor cannot pull one of their
// unrelated conversations into a run funded by the creator.
describe("buildServerCallLlmContext — refer_topic share gate limits topic references to this share's own topics", () => {
  it('injects the referenced topic content for a non-share run', async () => {
    topicFindByIdMock.mockResolvedValue({
      agentId: AGENT_ID,
      historySummary: 'Some prior summary',
      id: 'topic-x',
      title: 'My topic',
    });

    await buildServerCallLlmContext({
      ctx: baseCtx(),
      llmPayload: buildPayload('<refer_topic id="topic-x" name="My topic" />hi'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    expect(engineInput.topicReferences).toEqual([
      { summary: 'Some prior summary', topicId: 'topic-x', topicTitle: 'My topic' },
    ]);
  });

  it('does not inject content for a topic that did not come from a share in a share run', async () => {
    // A plain topic with no `shareId` at all — it did not come from this
    // share, so the run must not read it even if the lookup returned it.
    topicFindByIdMock.mockResolvedValue({
      agentId: AGENT_ID,
      historySummary: 'Private creator content',
      id: 'topic-private',
      title: 'Creator private topic',
    });

    await buildServerCallLlmContext({
      ctx: baseCtx({
        principal: resolveRunPrincipal({
          agentShare: { shareId: 'share-1', agentId: AGENT_ID, visitorUserId: VISITOR_USER_ID },
          userId: CREATOR_USER_ID,
        }),
      }),
      llmPayload: buildPayload('<refer_topic id="topic-private" name="Creator private topic" />hi'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    // No summary/recentMessages leaked — only the referenced tag's own id/title echoed back.
    expect(engineInput.topicReferences).toEqual([
      { topicId: 'topic-private', topicTitle: 'Creator private topic' },
    ]);
    expect(messageQueryMock).not.toHaveBeenCalled();
  });

  it('does not inject content for a topic from a different share instance', async () => {
    // Same visitor, same agent, but a share the owner has since taken down
    // and republished — `shareId` is what tells the two apart.
    topicFindByIdMock.mockResolvedValue({
      agentId: AGENT_ID,
      historySummary: 'Other visitor content',
      id: 'topic-other-visitor',
      shareId: 'share-0',
      title: 'Other visitor topic',
    });

    await buildServerCallLlmContext({
      ctx: baseCtx({
        principal: resolveRunPrincipal({
          agentShare: { shareId: 'share-1', agentId: AGENT_ID, visitorUserId: VISITOR_USER_ID },
          userId: CREATOR_USER_ID,
        }),
      }),
      llmPayload: buildPayload('<refer_topic id="topic-other-visitor" />hi'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    expect(engineInput.topicReferences).toEqual([
      { topicId: 'topic-other-visitor', topicTitle: undefined },
    ]);
  });

  it('injects content when the share visitor references their own topic', async () => {
    topicFindByIdMock.mockResolvedValue({
      agentId: AGENT_ID,
      historySummary: 'Visitor own summary',
      id: 'topic-own',
      shareId: 'share-1',
      title: 'My own topic',
    });

    await buildServerCallLlmContext({
      ctx: baseCtx({
        principal: resolveRunPrincipal({
          agentShare: { shareId: 'share-1', agentId: AGENT_ID, visitorUserId: VISITOR_USER_ID },
          userId: CREATOR_USER_ID,
        }),
      }),
      llmPayload: buildPayload('<refer_topic id="topic-own" />hi'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    expect(engineInput.topicReferences).toEqual([
      { summary: 'Visitor own summary', topicId: 'topic-own', topicTitle: 'My own topic' },
    ]);
  });
});

describe('buildServerCallLlmContext — agent context documents share gate (fail closed)', () => {
  const alwaysDoc = {
    content: 'Full ALWAYS document body',
    filename: 'always.md',
    id: 'doc-1',
    isFolder: false,
    policyLoad: 'always',
    title: 'Always doc',
  };

  it('injects ALWAYS documents for a non-share run', async () => {
    getAgentContextDocumentsMock.mockResolvedValue([alwaysDoc]);

    await buildServerCallLlmContext({
      ctx: baseCtx(),
      llmPayload: buildPayload('hello'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    expect(getAgentContextDocumentsMock).toHaveBeenCalledWith(AGENT_ID);
    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    expect(engineInput.agentDocuments).toEqual([expect.objectContaining({ id: 'doc-1' })]);
  });

  it('does not fetch/inject ALWAYS documents for a share run with no filePermissionConfig', async () => {
    getAgentContextDocumentsMock.mockResolvedValue([alwaysDoc]);

    await buildServerCallLlmContext({
      ctx: baseCtx({
        principal: resolveRunPrincipal({
          agentShare: { shareId: 'share-1', agentId: AGENT_ID, visitorUserId: VISITOR_USER_ID },
          userId: CREATOR_USER_ID,
        }),
      }),
      llmPayload: buildPayload('hello'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    expect(getAgentContextDocumentsMock).not.toHaveBeenCalled();
    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    expect(engineInput.agentDocuments).toBeUndefined();
  });

  it('injects ALWAYS documents for a share run when filePermissionConfig.agentFiles is "read"', async () => {
    getAgentContextDocumentsMock.mockResolvedValue([alwaysDoc]);

    await buildServerCallLlmContext({
      ctx: baseCtx({
        principal: resolveRunPrincipal({
          agentShare: {
            shareId: 'share-1',
            agentId: AGENT_ID,
            filePermissionConfig: { agentFiles: 'read' },
            visitorUserId: VISITOR_USER_ID,
          },
          userId: CREATOR_USER_ID,
        }),
      }),
      llmPayload: buildPayload('hello'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    expect(getAgentContextDocumentsMock).toHaveBeenCalledWith(AGENT_ID);
    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    expect(engineInput.agentDocuments).toEqual([expect.objectContaining({ id: 'doc-1' })]);
  });

  it('does not fetch ALWAYS documents for a share run with filePermissionConfig.agentFiles "none"', async () => {
    getAgentContextDocumentsMock.mockResolvedValue([alwaysDoc]);

    await buildServerCallLlmContext({
      ctx: baseCtx({
        principal: resolveRunPrincipal({
          agentShare: {
            shareId: 'share-1',
            agentId: AGENT_ID,
            filePermissionConfig: { agentFiles: 'none' },
            visitorUserId: VISITOR_USER_ID,
          },
          userId: CREATOR_USER_ID,
        }),
      }),
      llmPayload: buildPayload('hello'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    expect(getAgentContextDocumentsMock).not.toHaveBeenCalled();
  });
});

describe('buildServerCallLlmContext — onboarding context share gate (fail closed)', () => {
  const onboardingAgentConfig = { chatConfig: {}, slug: 'web-onboarding', systemRole: 'test' };

  it("builds onboarding context for the creator's own run", async () => {
    await buildServerCallLlmContext({
      ctx: baseCtx({ agentConfig: onboardingAgentConfig as any }),
      llmPayload: buildPayload('hello'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    // The creator's own onboarding data is read as before — the gate below is
    // the only thing that changes for a share run.
    expect(onboardingGetStateMock).toHaveBeenCalled();
    expect(getLatestPersonaDocumentMock).toHaveBeenCalled();
  });

  it('never builds onboarding context for a share visitor run', async () => {
    await buildServerCallLlmContext({
      ctx: baseCtx({
        agentConfig: onboardingAgentConfig as any,
        principal: resolveRunPrincipal({
          agentShare: { shareId: 'share-1', agentId: AGENT_ID, visitorUserId: VISITOR_USER_ID },
          userId: CREATOR_USER_ID,
        }),
      }),
      llmPayload: buildPayload('hello'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: emptyTooling,
    });

    expect(onboardingGetStateMock).not.toHaveBeenCalled();
    expect(getLatestPersonaDocumentMock).not.toHaveBeenCalled();
    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    expect(engineInput.onboardingContext).toBeUndefined();
  });

  it('does not build onboarding context for a share run that whitelisted lobe-web-onboarding', async () => {
    await buildServerCallLlmContext({
      ctx: baseCtx({
        principal: resolveRunPrincipal({
          agentShare: {
            shareId: 'share-1',
            agentId: AGENT_ID,
            filePermissionConfig: { agentFiles: 'read' },
            visitorUserId: VISITOR_USER_ID,
          },
          userId: CREATOR_USER_ID,
        }),
      }),
      llmPayload: buildPayload('hello'),
      model: 'gpt-4',
      provider: 'openai',
      state: baseState(),
      tooling: {
        ...emptyTooling,
        resolved: { ...emptyTooling.resolved, enabledToolIds: ['lobe-web-onboarding'] } as any,
      },
    });

    expect(onboardingGetStateMock).not.toHaveBeenCalled();
    const engineInput = serverMessagesEngineMock.mock.calls[0][0];
    expect(engineInput.onboardingContext).toBeUndefined();
  });
});
