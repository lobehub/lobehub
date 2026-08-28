// @vitest-environment node
/**
 * End-to-end integration tests for the share-visitor surface, against a real
 * Postgres — the one pass the rest of the share suites cannot give: every
 * other test either mocks the database or drives a single layer directly.
 *
 * What this file is actually guarding is the SPLIT IDENTITY of a share run.
 * The visitor drives it and OWNS the conversation it produces
 * (`actorUserId`), while everything the run consumes — agent config,
 * credentials, budget — belongs to the creator (`resourceOwnerUserId`). No
 * single layer can prove that split holds: the router resolves the share,
 * `AiAgentService` builds the principal, and `TopicModel`/`MessageModel` are
 * the only things that actually write `user_id` / `share_id`. A mocked seam
 * anywhere in that chain would let a run that persists the conversation under
 * the CREATOR pass — which is precisely the leak the whole refactor exists to
 * prevent, since a creator-owned row is one forgotten filter away from the
 * creator's home, unread counts and memory extraction.
 */
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentShareModel } from '@/database/models/agentShare';
import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';

import { shareChatRouter } from '../../shareChat';
import { createMockResponsesAPIStream, waitForOperationComplete } from './aiAgent/helpers';
import { cleanupTestUser, createTestUser } from './setup';

// Set fake API key for testing to bypass OpenAI SDK validation
process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Pin the cloud-only capability open so the visitor procedures under test are
// reachable in OSS CI, where ENABLE_BUSINESS_FEATURES is false and the
// shareChatProcedure middleware would reject everything with FORBIDDEN.
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal()),
  ENABLE_BUSINESS_FEATURES: true,
}));

// Mock FileService to avoid S3 environment variable requirements
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
}));

/** A share turn drives a full runtime pass; 5s (vitest's default) is not enough. */
const SHARE_TURN_TEST_TIMEOUT = 20_000;

let mockResponsesCreate: any;

let serverDB: LobeChatDatabase;
let creatorId: string;
let visitorId: string;
let sharedAgentId: string;
let shareId: string;

const visitorContext = () => ({
  jwtPayload: { userId: visitorId },
  userId: visitorId,
});

beforeEach(async () => {
  serverDB = await getTestDB();
  testDB = serverDB;

  creatorId = await createTestUser(serverDB);
  visitorId = await createTestUser(serverDB);

  const [agent] = await serverDB
    .insert(agents)
    .values({
      model: 'gpt-5-pro',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
      title: 'Shared Assistant',
      userId: creatorId,
    })
    .returning();
  sharedAgentId = agent.id;

  const share = await new AgentShareModel(serverDB, creatorId).create(sharedAgentId, 'link');
  shareId = share.id;

  mockResponsesCreate = vi.spyOn(OpenAI.Responses.prototype, 'create');
  mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Hi from the shared agent'));
});

afterEach(async () => {
  await cleanupTestUser(serverDB, creatorId);
  await cleanupTestUser(serverDB, visitorId);
  vi.clearAllMocks();
  vi.restoreAllMocks();

  inMemoryAgentStateManager.clear();
  inMemoryStreamEventManager.clear();
});

describe('shareChat end-to-end (real Postgres)', () => {
  it('persists a visitor run under the visitor, stamped with the share instance', async () => {
    const caller = shareChatRouter.createCaller(visitorContext());

    const result = await caller.execAgent({ prompt: 'Hello from a visitor', shareId });

    expect(result.success).toBe(true);
    expect(result.operationId).toBeDefined();

    const [topic] = await serverDB.select().from(topics).where(eq(topics.agentId, sharedAgentId));

    // The whole point of the split principal: the conversation is the
    // VISITOR's row, and `shareId` is what marks where it came from.
    expect(topic.userId).toBe(visitorId);
    expect(topic.shareId).toBe(shareId);

    const rows = await serverDB.select().from(messages).where(eq(messages.topicId, topic.id));

    // The visitor's own prompt and the assistant placeholder land under the
    // visitor too — a run that wrote them under `creatorId` would put the
    // visitor's words inside the creator's account, where every
    // creator-facing surface would have to remember to filter them back out.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set([visitorId]));
    expect(rows.some((row) => row.role === 'user' && row.content === 'Hello from a visitor')).toBe(
      true,
    );
  });

  it(
    'keeps a second turn on the same topic instead of opening a new one',
    async () => {
      const caller = shareChatRouter.createCaller(visitorContext());

      const first = await caller.execAgent({ prompt: 'First turn', shareId });
      const [topic] = await serverDB.select().from(topics).where(eq(topics.agentId, sharedAgentId));

      // Share runs start non-interactively on purpose, so a second send while
      // the first is still live is REJECTED rather than allowed to displace it
      // (see `shareChat.execAgent`'s `interactiveStart: false` comment). Wait
      // the first run out, exactly as a visitor's own client would.
      const firstState = await waitForOperationComplete(
        inMemoryAgentStateManager,
        first.operationId!,
      );
      // `waitForOperationComplete` treats `error` as terminal too, so without
      // this the whole flow can fail and still read as "the run finished".
      // A share run that errors out is exactly how an identity-scoping
      // regression surfaces (the runtime looking for the visitor's rows under
      // the creator's id), so pin the status explicitly.
      expect(firstState.status).toBe('done');

      await caller.execAgent({ prompt: 'Second turn', shareId, topicId: topic.id });

      const allTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.agentId, sharedAgentId));
      expect(allTopics).toHaveLength(1);

      const rows = await serverDB.select().from(messages).where(eq(messages.topicId, topic.id));
      expect(rows.filter((row) => row.role === 'user').map((row) => row.content)).toEqual([
        'First turn',
        'Second turn',
      ]);
    },
    SHARE_TURN_TEST_TIMEOUT,
  );

  it('shows the visitor its own conversation through getTopics / getMessages', async () => {
    const caller = shareChatRouter.createCaller(visitorContext());

    await caller.execAgent({ prompt: 'Readable turn', shareId });
    const [topic] = await serverDB.select().from(topics).where(eq(topics.agentId, sharedAgentId));

    const visitorTopics = await caller.getTopics({ shareId });
    expect(visitorTopics.map((item) => item.id)).toEqual([topic.id]);

    const visitorMessages = await caller.getMessages({ shareId, topicId: topic.id });
    expect(visitorMessages.some((message) => message.content === 'Readable turn')).toBe(true);
  });

  it('hides a creator topic that was never shared with this visitor', async () => {
    // A creator-owned topic on the SAME agent, with no `shareId` — the shape
    // an ordinary (non-share) conversation has.
    const [creatorTopic] = await serverDB
      .insert(topics)
      .values({ agentId: sharedAgentId, title: 'Creator private topic', userId: creatorId })
      .returning();

    const caller = shareChatRouter.createCaller(visitorContext());

    expect(await caller.getTopics({ shareId })).toEqual([]);
    await expect(caller.getMessages({ shareId, topicId: creatorTopic.id })).rejects.toThrow();
    await expect(
      caller.execAgent({ prompt: 'Sneaking in', shareId, topicId: creatorTopic.id }),
    ).rejects.toThrow();
  });

  it("refuses one of the visitor's own topics that did not come from this share", async () => {
    // Ownership alone is satisfied here — the row IS the visitor's. What must
    // still reject it is `topics.shareId`: without that half, a visitor could
    // aim any private conversation of their own at this endpoint and have it
    // executed with the creator's agent, credentials and budget.
    const [ownTopic] = await serverDB
      .insert(topics)
      .values({ agentId: sharedAgentId, title: 'My own topic', userId: visitorId })
      .returning();

    const caller = shareChatRouter.createCaller(visitorContext());

    expect(await caller.getTopics({ shareId })).toEqual([]);
    await expect(caller.getMessages({ shareId, topicId: ownTopic.id })).rejects.toThrow();
    await expect(
      caller.execAgent({ prompt: 'Sneaking in', shareId, topicId: ownTopic.id }),
    ).rejects.toThrow();
  });

  it('fails closed once the creator revokes the share', async () => {
    const caller = shareChatRouter.createCaller(visitorContext());
    await caller.execAgent({ prompt: 'Before revocation', shareId });

    await new AgentShareModel(serverDB, creatorId).updateVisibility(sharedAgentId, 'private');

    await expect(caller.execAgent({ prompt: 'After revocation', shareId })).rejects.toThrow();
    await expect(caller.getTopics({ shareId })).rejects.toThrow();
  });

  it('refuses a visitor who names a share that does not exist', async () => {
    const caller = shareChatRouter.createCaller(visitorContext());

    await expect(
      caller.execAgent({ prompt: 'No such share', shareId: 'agsh_does_not_exist' }),
    ).rejects.toThrow();
  });
});
