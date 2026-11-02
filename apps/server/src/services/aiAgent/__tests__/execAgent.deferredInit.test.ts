import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyOperationInitSlots,
  buildPreInitState,
  pickOperationInitSlots,
} from '@/server/services/agentRuntime/AgentRuntimeService/operationInitSlots';

import { AiAgentService } from '../index';
import type * as OperationInitModule from '../pipeline/operationInit';
import { runOperationInit } from '../pipeline/operationInit';

// Use vi.hoisted to ensure mock functions are available before vi.mock runs
const {
  mockMessageCreate,
  mockMessageFindById,
  mockMessageQuery,
  mockCreateOperation,
  mockFindShareById,
  mockQueryTree,
  mockTopicFindById,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockFindShareById: vi.fn(),
  mockQueryTree: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageFindById: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockTopicFindById: vi.fn(),
}));

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: {
    findByShareId: mockFindShareById,
    isRunStillAuthorized: vi.fn().mockResolvedValue(true),
  },
}));

// Pass-through spy: the seam under test is what each path hands the init.
vi.mock('../pipeline/operationInit', async (importOriginal) => {
  const actual = await importOriginal<typeof OperationInitModule>();
  return { ...actual, runOperationInit: vi.fn(actual.runOperationInit) };
});

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      create: mockMessageCreate,
      findById: mockMessageFindById,
      getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      query: mockMessageQuery,
      queryTopicMessageTree: mockQueryTree,
      update: vi.fn().mockResolvedValue({}),
    };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        files: [],
        id: 'agent-1',
        knowledgeBases: [],
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      }),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        files: [],
        id: 'agent-1',
        knowledgeBases: [],
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      }),
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
      tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue({ id: 'topic-new' }),
      findById: mockTopicFindById,
      updateMetadata: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// Real implementation wraps the create in a `db.transaction(...)` for
// per-visitor cap enforcement — irrelevant to the read-side guard under test
// here, and `mockDb = {}` has no `transaction`. Delegate straight to the
// underlying model methods so a share-gated run in these tests exercises the
// same message-creation call the non-share path does.
vi.mock('../shareVisitorAbuseGuards', () => ({
  // Not exercised by these tests (they all target an existing topic), but
  // stubbed so an accidental new-topic share run doesn't hit `db.transaction`.
  reserveShareVisitorTopic: vi.fn().mockResolvedValue({ id: 'topic-shared-new' }),
  reserveShareVisitorTurn: vi.fn(function (_params, createParams, id) {
    return mockMessageCreate(createParams, id);
  }),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };
  }),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: mockCreateOperation,
    };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(function () {
    return {
      getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return {
      getComposioManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      uploadFromUrl: vi.fn(),
    };
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

/** A JSON round trip: the state reaches the worker through Redis. */
// eslint-disable-next-line unicorn/prefer-structured-clone -- JSON semantics (dropped `undefined`s) are the point
const throughRedis = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * Drop what is rebuilt per process, the `undefined`s JSON would drop anyway, and
 * an empty `appContext` — every stage reads it optionally, so `{}` reads as none.
 */
const comparableContext = ({ runFacts: _runFacts, ...ctx }: any) => {
  const json = throughRedis(ctx);
  if (json.appContext && Object.keys(json.appContext).length === 0) delete json.appContext;
  return json;
};

// The deferred init has to see the run exactly as the send path did and write
// exactly what `createOperation` writes. Both halves are driven end to end
// here: the send path runs as usual, then the worker rebuilds the run from the
// state the send path would have created before its init and runs it again.
describe('AiAgentService.runDeferredInit - parity with the send path', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';
  const rows = new Map<string, any>();

  beforeEach(() => {
    vi.clearAllMocks();
    rows.clear();
    let nextId = 0;
    mockMessageCreate.mockImplementation(async (params: any, id?: string) => {
      const row = { ...params, id: id ?? `msg-${++nextId}` };
      rows.set(row.id, row);
      return row;
    });
    mockMessageFindById.mockImplementation(async (id: string) => rows.get(id));
    mockMessageQuery.mockResolvedValue([
      { content: 'earlier question', id: 'msg-prev-1', role: 'user' },
      { content: 'earlier answer', id: 'msg-prev-2', role: 'assistant' },
    ]);
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockTopicFindById.mockResolvedValue(undefined);
    mockQueryTree.mockResolvedValue([]);

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.mocked(runOperationInit).mockClear();
  });

  const sendThenDefer = async (params: Parameters<AiAgentService['execAgent']>[0]) => {
    await service.execAgent(params);

    expect(runOperationInit).toHaveBeenCalledTimes(1);
    const [, sendCtx, request, operationId] = vi.mocked(runOperationInit).mock.calls[0];
    const created = mockCreateOperation.mock.calls[0][0];
    const preInitState = buildPreInitState(created, {});

    const deferred = await service.runDeferredInit({
      operationId,
      request: throughRedis(request),
      state: throughRedis({ ...preInitState, request }) as any,
    });

    expect(runOperationInit).toHaveBeenCalledTimes(2);
    const [, workerCtx, workerRequest, workerOperationId] =
      vi.mocked(runOperationInit).mock.calls[1];

    return {
      created,
      deferred,
      operationId,
      preInitState,
      request,
      sendCtx,
      workerCtx,
      workerOperationId,
      workerRequest,
    };
  };

  it('rebuilds the run context and writes the same slots for a follow-up turn', async () => {
    const run = await sendThenDefer({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-existing' },
      prompt: 'a follow-up question',
    });

    expect(run.workerOperationId).toBe(run.operationId);
    expect(throughRedis(run.workerRequest)).toEqual(throughRedis(run.request));
    expect(comparableContext(run.workerCtx)).toEqual(comparableContext(run.sendCtx));

    expect(run.deferred.context).toEqual(throughRedis(run.created.initialContext));
    expect(throughRedis(run.deferred.state)).toEqual(
      throughRedis({
        ...applyOperationInitSlots(run.preInitState, pickOperationInitSlots(run.created)),
        request: run.request,
      }),
    );
  });

  it('reads no history for a turn that opened a new topic, as the send path does', async () => {
    const run = await sendThenDefer({ agentId: 'agent-1', prompt: 'a first question' });

    expect(comparableContext(run.workerCtx)).toEqual(comparableContext(run.sendCtx));
    expect(run.deferred.state.messages).toEqual(throughRedis(run.created.initialMessages));
  });

  // A regenerate has no user row of its own and prunes the branch it replaces.
  it('rebuilds a regenerate, which has no user row, and prunes the same branch', async () => {
    rows.set('u1', { content: 'the question', id: 'u1', role: 'user', topicId: 'topic-1' });
    mockMessageQuery.mockResolvedValue([
      { content: 'the question', id: 'u1', role: 'user' },
      { content: 'OLD answer', id: 'a1', parentId: 'u1', role: 'assistant' },
    ]);
    mockQueryTree.mockResolvedValue([
      { id: 'u1', messageGroupId: null, parentId: null },
      { id: 'a1', messageGroupId: null, parentId: 'u1' },
    ]);

    const run = await sendThenDefer({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      parentMessageId: 'u1',
      prompt: 'ignored',
      resume: true,
    });

    expect(run.workerCtx.userMessageId).toBeUndefined();
    expect(comparableContext(run.workerCtx)).toEqual(comparableContext(run.sendCtx));
    expect(run.deferred.state.messages?.map((m: any) => m.id)).toEqual(['u1']);
    expect(run.deferred.state.messages).toEqual(throughRedis(run.created.initialMessages));
  });

  describe('a share visitor run', () => {
    const shareGate = {
      agentId: 'agent-1',
      shareConfig: { toolGrants: [] },
      shareId: 'share-1',
      visitorUserId: 'visitor-1',
    };
    const liveShare = {
      agentId: 'agent-1',
      ownerId: userId,
      shareConfig: shareGate.shareConfig,
      shareId: 'share-1',
      visibility: 'link',
    };

    it('works under the share as it stands, exactly as the send path did', async () => {
      mockFindShareById.mockResolvedValue(liveShare);

      const run = await sendThenDefer({ agentId: 'agent-1', prompt: 'Hello', shareGate });

      expect(mockFindShareById).toHaveBeenCalledWith(mockDb, 'share-1');
      expect(comparableContext(run.workerCtx)).toEqual(comparableContext(run.sendCtx));
      expect(throughRedis(run.deferred.state.operationToolSet)).toEqual(
        throughRedis(run.created.toolSet),
      );
    });

    it.each([
      ['gone', null],
      ['no longer public', { ...liveShare, visibility: 'private' }],
      ['moved to another agent', { ...liveShare, agentId: 'agent-2' }],
    ])('refuses to initialize when the share is %s', async (_label, share) => {
      mockFindShareById.mockResolvedValue(liveShare);
      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', shareGate });
      const [, , request, operationId] = vi.mocked(runOperationInit).mock.calls[0];
      const state = buildPreInitState(mockCreateOperation.mock.calls[0][0], {});

      mockFindShareById.mockResolvedValue(share);

      await expect(
        service.runDeferredInit({
          operationId,
          request: throughRedis(request),
          state: throughRedis({ ...state, request }) as any,
        }),
      ).rejects.toThrow('no longer authorizes this run');
      expect(runOperationInit).toHaveBeenCalledTimes(1);
    });
  });
});
