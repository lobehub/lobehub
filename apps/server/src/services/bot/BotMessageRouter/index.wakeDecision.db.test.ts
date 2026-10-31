// @vitest-environment node
import {
  agents,
  llmGenerationTracing,
  signalDecisions,
  signals,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordSignalDecision } from '@/server/services/agentSignal/persistence/recordDecision';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockGetBotFeatureAccessState,
  mockGetList,
  mockGetServerDB,
  mockHandleMention,
  mockHandleSubscribedMessage,
  mockOnNewMention,
  mockOnNewMessage,
  mockOnSubscribedMessage,
  resetBotMessageRouterMocks,
} from './testUtils';

const db = await getTestDB();
const userId = 'wake-db-user';
const agentId = 'wake-db-agent';

vi.mock('@/server/featureFlags', async () => (await import('./testUtils')).featureFlagsModule());
vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/database/models/agentBotProvider', async () =>
  (await import('./testUtils')).agentBotProviderModule(),
);
vi.mock('../dmPairingStore', async () => (await import('./testUtils')).dmPairingStoreModule());
vi.mock('@/server/modules/KeyVaultsEncrypt', async () =>
  (await import('./testUtils')).keyVaultsEncryptModule(),
);
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).redisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/app', async () => (await import('./testUtils')).appModule());
vi.mock('@chat-adapter/state-ioredis', async () =>
  (await import('./testUtils')).stateIoredisModule(),
);
vi.mock('chat', async () => (await import('./testUtils')).chatModule());
vi.mock('../deferredMessages', async () => (await import('./testUtils')).deferredMessagesModule());
vi.mock('../mergeMessages', async (importOriginal) =>
  (await import('./testUtils')).mergeMessagesModule(importOriginal),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('../AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('../platforms', async () => (await import('./testUtils')).platformsModule());

/** The recorder is fire-and-forget; poll until its detached write lands (or give up). */
const settle = async (expected: number) => {
  for (let i = 0; i < 50; i++) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(signalDecisions);
    if (count >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const boot = async (settings: Record<string, unknown>) => {
  mockFindEnabledByPlatform.mockResolvedValue([
    makeProvider({ agentId, applicationId: 'app-1', settings, userId }),
  ]);
  await new BotMessageRouter().getWebhookHandler(
    'discord',
    'app-1',
  )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));
};

const mentionHandler = () => mockOnNewMention.mock.calls.at(-1)![0];
const subscribedHandler = () => mockOnSubscribedMessage.mock.calls.at(-1)![0];
const catchAllHandler = () =>
  mockOnNewMessage.mock.calls.find((c) => c[0] instanceof RegExp && c[0].source === '.')![1];

const thread = (id: string, overrides = {}) => ({
  id,
  isDM: false,
  post: vi.fn().mockResolvedValue(undefined),
  setState: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});
const message = (id: string, text: string, overrides = {}) => ({
  author: { isBot: false, userId: 'alice-id', userName: 'alice' },
  id,
  isMention: false,
  text,
  ...overrides,
});

const rows = async () =>
  db
    .select({
      entryPoint: sql<string>`${signals.metadata}->>'entryPoint'`,
      externalId: signals.externalId,
      finalReason: signalDecisions.finalReason,
      metadata: signalDecisions.metadata,
      outcome: signalDecisions.outcome,
      pipelineVersion: signalDecisions.pipelineVersion,
      scopeKey: signalDecisions.scopeKey,
      signalMetadata: signals.metadata,
      signalPayload: signals.payload,
      source: signals.source,
      toTag: signalDecisions.toTag,
      verdicts: signalDecisions.verdicts,
    })
    .from(signalDecisions)
    .innerJoin(signals, eq(signals.id, signalDecisions.signalId))
    .orderBy(signalDecisions.createdAt);

describe('mock Discord bot-wake decision records (real database, real router handlers)', () => {
  beforeEach(async () => {
    resetBotMessageRouterMocks();
    mockGetServerDB.mockResolvedValue(db);
    mockGetList.mockResolvedValue(['alice-id', 'bob-id']);
    await db.delete(users);
    await db.insert(users).values({ id: userId });
    await db.insert(agents).values({ id: agentId, userId });
  });

  afterEach(async () => {
    await db.delete(users);
  });

  it('persists one decision per inbound path and leaves the wake/skip behavior as it was', async () => {
    await boot({
      dmPolicy: 'open',
      // The reply opening adds its own verdict; it is covered in `index.replyOpening.test.ts`.
      replyPlacement: 'thread',
      watchKeywords: [{ instruction: '', keyword: 'deploy' }],
    });
    mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });

    // 1. onNewMention: @-mention in a guild channel.
    await mentionHandler()(
      thread('discord:guild-1:channel-1'),
      message('m-mention', '@bot hello', { isMention: true }),
    );
    // 2. onSubscribedMessage: chatter nobody addressed to the bot (skip), then an @-mention (wake).
    await subscribedHandler()(
      thread('discord:guild-1:channel-1:thread-1'),
      message('m-chatter', 'lunch anyone?'),
    );
    await subscribedHandler()(
      thread('discord:guild-1:channel-1:thread-1'),
      message('m-sub-mention', '@bot summarize', { isMention: true }),
    );
    // 3. catch-all: a watch-keyword hit in a channel (wake) and a DM (wake).
    await catchAllHandler()(
      thread('discord:guild-1:channel-2'),
      message('m-keyword', 'please deploy now'),
    );
    await catchAllHandler()(thread('discord:dm-1', { isDM: true }), message('m-dm', 'hi in dm'));

    await settle(5);

    // Behavior: exactly the messages that woke the bot before still wake it.
    expect(mockHandleMention.mock.calls.map(([, m]) => m.id)).toEqual([
      'm-mention',
      'm-keyword',
      'm-dm',
    ]);
    expect(mockHandleSubscribedMessage.mock.calls.map(([, m]) => m.id)).toEqual(['m-sub-mention']);

    const stored = await rows();
    console.log('SIGNAL_DECISIONS_ROWS\n' + JSON.stringify(stored, null, 2));
    // Writes are fire-and-forget, so compare by message id rather than by insertion order.
    const byMessage = Object.fromEntries(
      stored.map((r) => [
        r.externalId.split(':').at(-1),
        [r.entryPoint, r.outcome, r.finalReason, r.toTag],
      ]),
    );
    expect(Object.values(byMessage)).toHaveLength(5);
    expect(
      ['m-mention', 'm-chatter', 'm-sub-mention', 'm-keyword', 'm-dm'].map((id) => byMessage[id]),
    ).toEqual([
      ['onNewMention', 'wake', 'explicit-mention', 'mention'],
      ['onSubscribedMessage', 'skip', 'not-addressed', 'ignored'],
      ['onSubscribedMessage', 'wake', 'explicit-mention', 'mention'],
      ['catchAll', 'wake', 'watch-keyword', 'keyword'],
      ['catchAll', 'wake', 'direct-message', 'dm'],
    ]);
    for (const row of stored) {
      expect(row).toMatchObject({
        pipelineVersion: 'bot-wake@3',
        scopeKey: 'discord:app-1',
        source: 'bot:discord',
      });
      expect(row.verdicts).toHaveLength(1);
      // What the source said stays in the payload; where it was addressed survives its purge.
      expect(Object.keys(row.signalPayload)).toEqual(['text']);
      expect(row.signalMetadata).toMatchObject({
        address: { applicationId: 'app-1', platform: 'discord' },
        entryPoint: row.entryPoint,
      });
      // The state the policies read is kept, so the decision can be replayed later.
      expect(row.metadata.stateSnapshot).toMatchObject({
        explicitMention: expect.any(Boolean),
        replyToBot: false,
        threadSubscribed: expect.any(Boolean),
      });
    }
  });

  it('links a classifier call by id to llm_generation_tracing without copying its content', async () => {
    const [tracing] = await db
      .insert(llmGenerationTracing)
      .values({
        promptHash: 'abc123',
        promptVersion: 'v1.0',
        scenario: 'bot_wake_classifier',
        success: true,
        userId,
      })
      .returning();
    const recorded = await recordSignalDecision(db, {
      agentId,
      decision: {
        llmTracingIds: [tracing.id],
        outcome: 'skip',
        pipelineVersion: 'bot-wake@3',
      },
      scopeKey: 'discord:app-1',
      signal: {
        externalId: 'app-1:discord:thread:m-classified',
        source: 'bot:discord',
        sourceType: 'bot.message.merged',
        type: 'bot.message.merged',
      },
      userId,
    });
    expect(recorded.persisted).toBe(true);

    const joined = await db.execute(sql`
      select d.id as decision_id, d.llm_tracing_ids, t.id as tracing_id, t.scenario, t.success
      from signal_decisions d
      join lateral jsonb_array_elements_text(d.llm_tracing_ids) as ref(id) on true
      join llm_generation_tracing t on t.id = ref.id::uuid
    `);
    console.log('LLM_TRACING_JOIN\n' + JSON.stringify(joined.rows, null, 2));
    expect(joined.rows).toHaveLength(1);
    expect(joined.rows[0]).toMatchObject({
      scenario: 'bot_wake_classifier',
      tracing_id: tracing.id,
    });

    const columns = await db.execute(sql`
      select column_name from information_schema.columns where table_name = 'signal_decisions'
    `);
    // Only ids are stored here — no prompt, output, model or token columns duplicate the tracing row.
    expect(columns.rows.map((c: any) => c.column_name)).not.toEqual(
      expect.arrayContaining(['prompt', 'output', 'model', 'input_tokens']),
    );
  });
});
