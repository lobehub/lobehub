// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as InternalJwtModule from '@/libs/trpc/utils/internalJwt';
import { AiAgentService } from '@/server/services/aiAgent';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

// Mock AgentRuntimeService since we only want to test the router's business logic
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: vi.fn(async (params: any) => {
        // The real runtime invokes this before the run's first step, with the
        // operation it is about to start; mirror it so the router's Task-run
        // reopen path runs when a test seeds a Task run. It is a no-op for the
        // ordinary conversation, which attaches no hooks.
        await params?.onOperationCreated?.(params?.operationId);
        return {
          success: true,
          operationId: params?.operationId ?? 'mock-operation-id',
          autoStarted: true,
          messageId: 'mock-message-id',
        };
      }),
    };
  }),
}));

// Mock serverMessagesEngine
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn(function () {
    return {
      generateToolsDetailed: vi.fn(function () {
        return { tools: [] };
      }),
      getEnabledPluginManifests: vi.fn(function () {
        return new Map();
      }),
    };
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ],
    metadata: {},
  }),
}));

// Mock AiChatService to avoid S3 dependency
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(function () {
    return {
      getMessagesAndTopics: vi.fn().mockResolvedValue({ messages: [], topics: [] }),
    };
  }),
}));

// Mock FileService to avoid S3 dependency
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      getFullFileUrl: vi.fn(function (path: string | null) {
        return path;
      }),
    };
  }),
}));

// Mock the resource-permission guard so workspace-mode tests can assert the
// router resolves slug → agent id and runs the `use` guard (the guard's own
// RBAC evaluation is covered by its service tests).
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
}));

// The user-hub token is a real RS256 signature in production; the integration
// DB has no JWKS_KEY, so pin the signer and assert the subject it is asked for.
const mockSignUserJWT = vi.fn();
vi.mock('@/libs/trpc/utils/internalJwt', async (importOriginal) => ({
  ...(await importOriginal<typeof InternalJwtModule>()),
  signUserJWT: (...args: any[]) => mockSignUserJWT(...args),
}));

// Mock model-bank with dynamic import to preserve other exports
vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        id: 'gpt-4o-mini',
        providerId: 'openai',
        abilities: { functionCall: true, vision: true, video: false },
      },
    ],
  };
});

describe('aiAgent router - composer user message on the batch route', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testAgentId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    const [agent] = await serverDB
      .insert(agents)
      .values({
        model: 'gpt-4o-mini',
        provider: 'openai',
        systemRole: 'You are a helpful assistant.',
        title: 'Test Agent',
        userId,
      })
      .returning();
    testAgentId = agent.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.restoreAllMocks();
  });

  const quote = { content: 'Quoted reply', id: 'selection-1', source: 'text' as const };
  const editorData = { root: { children: [], type: 'root' } };

  const userMessagesSent = () => {
    const spy = vi.spyOn(AiAgentService.prototype, 'execAgent');
    return () => spy.mock.calls.map(([params]) => params.userMessage);
  };

  // ROOT CAUSE:
  //
  // `execAgents` validates each task with `ExecAgentSchema`, so a batch task
  // accepted `userMessage` (and the deprecated top-level selections), but the
  // route rebuilt the service params from a fixed field list that left them
  // out: the run succeeded while the stored message and the model lost them.
  it('forwards the user message, including the legacy selection fields, per task', async () => {
    const userMessagesOf = userMessagesSent();
    const caller = aiAgentRouter.createCaller({ jwtPayload: { userId }, userId });

    await caller.execAgents({
      parallel: false,
      tasks: [
        {
          agentId: testAgentId,
          prompt: 'Explain this',
          userMessage: { editorData, metadata: { contextSelections: [quote] } },
        },
        { agentId: testAgentId, contextSelections: [quote], prompt: 'Explain that' },
        { agentId: testAgentId, prompt: 'Plain' },
      ],
    });

    expect(userMessagesOf()).toEqual([
      { editorData, metadata: { contextSelections: [quote] } },
      { metadata: { contextSelections: [quote] } },
      undefined,
    ]);
  });
});
