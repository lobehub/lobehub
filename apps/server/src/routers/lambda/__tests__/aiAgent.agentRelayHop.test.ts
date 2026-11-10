// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, agents, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as InternalJwtModule from '@/libs/trpc/utils/internalJwt';
import { MAX_AGENT_RELAY_HOPS } from '@/server/services/aiAgent/sourceAttribution';

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

describe('aiAgent router - agent relay hops', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let writerAgentId: string;
  let verifierAgentId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    const rows = await serverDB
      .insert(agents)
      .values(
        ['Writer', 'Verifier'].map((title) => ({
          model: 'gpt-4o-mini',
          provider: 'openai',
          systemRole: 'You are a helpful assistant.',
          title,
          userId,
        })),
      )
      .returning();
    writerAgentId = rows[0].id;
    verifierAgentId = rows[1].id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.restoreAllMocks();
  });

  /**
   * The writer's run is in flight in its own conversation, started by `trigger`
   * — a person (no sender) or another agent's message `hop` sends deep.
   */
  const seedSendingRun = async (triggerHop?: number) => {
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: writerAgentId, title: 'Storytelling', userId })
      .returning();
    await serverDB.insert(messages).values({
      agentId: writerAgentId,
      content: 'feedback',
      metadata: triggerHop
        ? { agentSender: { agentId: verifierAgentId, hop: triggerHop } }
        : undefined,
      role: 'user',
      topicId: topic.id,
      userId,
    });
    const operationId = `op-writer-${triggerHop ?? 0}`;
    await serverDB.insert(agentOperations).values({
      agentId: writerAgentId,
      id: operationId,
      status: 'running',
      topicId: topic.id,
      userId,
    });
    return { operationId, topicId: topic.id };
  };

  const send = (sourceOperationId: string) =>
    aiAgentRouter
      .createCaller({ jwtPayload: { userId }, userId })
      .execAgent({ agentId: verifierAgentId, prompt: 'Iterate the verifier', sourceOperationId });

  it('stamps the next hop on the message an agent sends', async () => {
    const { operationId, topicId } = await seedSendingRun(2);

    const result = await send(operationId);

    const [sent] = await serverDB
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(and(eq(messages.topicId, result.topicId!), eq(messages.role, 'user')));
    expect(sent.metadata).toMatchObject({
      agentSender: { agentId: writerAgentId, hop: 3, topicId },
    });
  });

  // ROOT CAUSE:
  //
  // An agent told to report back to another agent after every round woke it,
  // which woke it back, with nothing to stop the pair.
  //
  // Before: every agent → agent send started a run.
  // After: a send past MAX_AGENT_RELAY_HOPS in a row is refused.
  it('refuses a send past the relay bound and starts nothing', async () => {
    const { operationId } = await seedSendingRun(MAX_AGENT_RELAY_HOPS);

    await expect(send(operationId)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });

    const verifierTopics = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.agentId, verifierAgentId));
    expect(verifierTopics).toHaveLength(0);
  });
});
