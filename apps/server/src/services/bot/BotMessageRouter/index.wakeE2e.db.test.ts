// @vitest-environment node
import { writeFileSync } from 'node:fs';

import { agents, signalDecisions, signals, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

/**
 * End-to-end bot-wake flow against a mock Discord channel.
 *
 * Real: the router handlers, the recorder + policy set + classifier policy, the scheduler and
 * its Redis state/lock, the Redis channel state, the signal_decisions rows (test Postgres).
 * Faked: the Discord gateway/adapter (messages are plain objects shaped like the adapter's),
 * QStash (a recording queue), the model provider (a scripted `generateObject`), and the agent
 * run itself (`handleSubscribedMessage`).
 *
 * NOT exercised, and therefore UNVERIFIED: the external message-gateway service (it is not in
 * this repository) and a real Discord connection. Whether the gateway actually forwards
 * un-mentioned channel messages once `messageMonitoring.enabled` is true is its own contract.
 *
 * Skipped unless BOT_WAKE_REAL_REDIS_URL points at a disposable Redis.
 */
const { redisPrefix, redisUrl } = vi.hoisted(() => {
  const url = process.env.BOT_WAKE_REAL_REDIS_URL;
  const prefix = `botwake-e2e-${Date.now()}`;
  // Hoisted above the imports: the Redis env is read when the modules load.
  if (url) {
    process.env.REDIS_URL = url;
    process.env.REDIS_PREFIX = prefix;
  }

  return { redisPrefix: prefix, redisUrl: url };
});

const env = vi.hoisted(() => ({
  queued: [] as { delay: number; endpoint: string; flowControl?: unknown; payload: any }[],
  parked: new Map<string, any[]>(),
  llm: { calls: [] as any[], mode: 'score' as 'hang' | 'score', score: 0.2 },
}));

vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class LocalQueueServiceImpl {},
}));
vi.mock('@/server/services/queue', () => ({
  QueueService: class {
    getImpl() {
      return {};
    }
    isLocalExecution() {
      return false;
    }
    async scheduleMessage(message: any) {
      env.queued.push(message);

      return 'queued';
    }
  },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: async () => ({
    generateObject: (payload: any, options: any) => {
      env.llm.calls.push({ options, payload });
      if (env.llm.mode === 'hang') return new Promise(() => {});

      return Promise.resolve({
        addressedToBot: env.llm.score,
        kind: env.llm.score >= 0.5 ? 'request' : 'chitchat',
        reason: 'scripted',
      });
    },
  }),
}));
vi.mock('../deferredMessages', async () => ({
  ...(await import('./testUtils')).deferredMessagesModule(),
  deferBotMessages: async (app: string, thread: string, messages: any[]) => {
    env.parked.set(`${app}:${thread}`, [
      ...(env.parked.get(`${app}:${thread}`) ?? []),
      ...messages,
    ]);

    return true;
  },
}));
vi.mock('../deferredReplay', () => ({
  runDeferredReplay: async (target: { applicationId: string; platformThreadId: string }) => {
    const key = `${target.applicationId}:${target.platformThreadId}`;
    const messages = env.parked.get(key) ?? [];
    env.parked.delete(key);
    const { mockOnSubscribedMessage: registered } = await import('./testUtils');
    const handler = registered.mock.calls.at(-1)![0];
    for (const message of messages) {
      await handler({ id: target.platformThreadId, isDM: false, post: vi.fn() }, message);
    }
  },
}));
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
vi.mock('../mergeMessages', async (importOriginal) =>
  (await import('./testUtils')).mergeMessagesModule(importOriginal),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('../AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('../platforms', async () => (await import('./testUtils')).platformsModule());

const GUILD = 'g1';
const CHANNEL = 'c1';
const THREAD = 't9';
const CHANNEL_THREAD_ID = `discord:${GUILD}:${CHANNEL}`;
const BOT_THREAD_ID = `${CHANNEL_THREAD_ID}:${THREAD}`;
const APP_ID = '555000111222333';
const OWNER = 'owner-id';
const CHANNEL_KEY = `discord:${APP_ID}:${GUILD}:${CHANNEL}`;
const THREAD_KEY = `${CHANNEL_KEY}:${THREAD}`;

const run = redisUrl ? describe : describe.skip;

run(
  'mock Discord bot-wake end to end (real router, Redis scheduler/state, signal_decisions)',
  () => {
    const db = redisUrl ? undefined : undefined;
    let testDb: Awaited<ReturnType<typeof getTestDB>>;
    let redis: IORedis;
    const transcript: string[] = [];
    const say = (line: string) => transcript.push(line);
    const clock = Date.parse('2026-10-24T08:00:00Z');
    const at = (seconds: number) => vi.setSystemTime(clock + seconds * 1000);

    const userId = 'wake-e2e-user';
    const agentId = 'wake-e2e-agent';

    beforeAll(async () => {
      void db;
      testDb = await getTestDB();
      redis = new IORedis(redisUrl!);
      vi.useFakeTimers({ toFake: ['Date'] });
      at(0);
    });

    afterAll(async () => {
      vi.useRealTimers();
      const keys = await redis.keys(`${redisPrefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
      redis.disconnect();
      await testDb.delete(users);
      if (process.env.BOT_WAKE_E2E_TRANSCRIPT) {
        writeFileSync(process.env.BOT_WAKE_E2E_TRANSCRIPT, transcript.join('\n') + '\n');
      }
      console.log(`\n${transcript.join('\n')}`);
    });

    beforeEach(async () => {
      resetBotMessageRouterMocks();
      mockGetServerDB.mockResolvedValue(testDb);
      mockGetList.mockResolvedValue(['alice-id', 'bob-id']);
      mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });
    });

    const rows = async () =>
      testDb
        .select({
          externalId: signals.externalId,
          finalReason: signalDecisions.finalReason,
          outcome: signalDecisions.outcome,
          text: sql<string>`${signals.payload}->>'text'`,
          verdicts: signalDecisions.verdicts,
        })
        .from(signalDecisions)
        .innerJoin(signals, sql`${signals.id} = ${signalDecisions.signalId}`)
        .orderBy(signalDecisions.createdAt);

    /** The recorder is fire-and-forget; wait until `count` rows exist. */
    const settle = async (count: number) => {
      for (let i = 0; i < 100; i++) {
        const found = await rows();
        if (found.length >= count) return found;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      return rows();
    };

    const verdictOf = (row: Awaited<ReturnType<typeof rows>>[number], policyId: string) =>
      (row.verdicts as any[]).find((verdict) => verdict.policyId === policyId);

    const describeRow = (row: Awaited<ReturnType<typeof rows>>[number]) =>
      `${row.outcome}/${row.finalReason} text=${JSON.stringify(row.text)} ` +
      (row.verdicts as any[])
        .map(
          (v) =>
            `${v.policyId}[${v.mode}]=${v.verdict}(${v.reason}${v.policyId.endsWith('classifier') ? ` score=${v.confidence}` : ''})`,
        )
        .join(' ');

    const message = (id: string, text: string, overrides: Record<string, unknown> = {}) => ({
      author: { isBot: false, isMe: false, userId: 'alice-id', userName: 'alice' },
      id,
      isMention: false,
      text,
      ...overrides,
    });
    const thread = (id: string) => ({
      id,
      isDM: false,
      post: vi.fn().mockResolvedValue(undefined),
      setState: vi.fn().mockResolvedValue(undefined),
    });

    const flushPayload = () => env.queued.at(-1)!.payload;
    const settings = {
      botWake: {
        classifier: { mode: 'shadow' },
        customInstructions: 'Only answer questions about deploys.',
        enabled: true,
        mode: 'shadow',
        rules: { maxSilentWakes: 3, ownerPresenceSeconds: 30, windowSeconds: 300 },
        scheduler: { mode: 'enforce' },
      },
      dmPolicy: 'open',
      userId: OWNER,
      watchKeywords: [{ instruction: '', keyword: 'deploy' }],
    };

    it('walks a Discord channel through owner presence, broadcast pings, a scheduled follow-up, the thread window, the budget and a classifier timeout', async () => {
      await testDb.delete(users);
      await testDb.insert(users).values({ id: userId });
      await testDb.insert(agents).values({ id: agentId, userId });
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ agentId, applicationId: APP_ID, settings, userId }),
      ]);
      await new BotMessageRouter().getWebhookHandler(
        'discord',
        APP_ID,
      )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));

      const catchAll = mockOnNewMessage.mock.calls.find(
        (c) => c[0] instanceof RegExp && c[0].source === '.',
      )![1];
      const subscribed = mockOnSubscribedMessage.mock.calls.at(-1)![0];
      const mention = mockOnNewMention.mock.calls.at(-1)![0];
      const { handleWakeFlush, recordWakeRunOutcome } = await import('../wake/scheduler');
      // The flush loads the provider (settings and owner) and checks the owner's rollout flag, which
      // the featureFlags mock above turns on.
      const loadSettings = async () => ({ settings, userId: 'owner-user' });
      const field = async (key: string, name: string) =>
        redis.hget(`${redisPrefix}:bot-wake:channel:v1:${key}`, name);

      say('# Mock Discord channel #c1 (guild g1), bot app 555000111222333, owner owner-id');
      say(
        '# settings.botWake: enabled, rules/classifier in shadow, scheduler=enforce, window 300s, silent-wake budget 3, owner presence 30s',
      );
      say(
        '# UNVERIFIED: the external message-gateway is not in this repo; only the router/scheduler/classifier/Redis/DB below were exercised.\n',
      );

      // 1. The owner speaks in the channel (no mention, no keyword): a passive observation.
      at(0);
      await catchAll(
        thread(CHANNEL_THREAD_ID),
        message('m1', 'let me look at prod', {
          author: { isBot: false, userId: OWNER, userName: 'owner' },
        }),
      );
      let found = await settle(1);
      say(`[t+0s] owner posts in channel -> ${describeRow(found[0])}`);
      expect(found[0]).toMatchObject({ finalReason: 'not-addressed', outcome: 'skip' });
      expect(await field(CHANNEL_KEY, 'ownerLastSpokeAt')).toBe(String(clock));
      say(
        `        redis ownerLastSpokeAt(${CHANNEL_KEY}) = ${await field(CHANNEL_KEY, 'ownerLastSpokeAt')}`,
      );

      // 2. A colleague pings @everyone; the adapter folded it into isMention=true.
      at(10);
      await mention(
        thread(CHANNEL_THREAD_ID),
        message('m2', '@everyone standup in 5', { isMention: true }),
      );
      found = await settle(2);
      say(`[t+10s] @everyone (adapter isMention=true) -> ${describeRow(found[1])}`);
      expect(mockHandleMention).toHaveBeenCalledTimes(1); // legacy behaviour untouched
      expect(verdictOf(found[1], 'bot-wake:internal-rules')).toMatchObject({
        mode: 'shadow',
        reason: 'broadcast-mention',
        verdict: 'deny',
      });

      // 3. A colleague mentions the keyword in the bot's thread: a follow-up wake, scheduled.
      at(60);
      env.llm.score = 0.2;
      await subscribed(thread(BOT_THREAD_ID), message('m3', 'should we deploy now?'));
      found = await settle(3);
      say(`[t+60s] 'deploy' in thread -> scheduler holds it -> ${describeRow(found[2])}`);
      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(found[2]).toMatchObject({ finalReason: 'scheduled', outcome: 'defer' });
      expect(env.queued).toHaveLength(1);
      expect(env.queued[0].delay).toBe(20_000);
      expect(env.queued[0].endpoint).toContain('/api/agent/webhooks/bot-wake-flush');
      expect(env.queued[0].flowControl).toEqual({
        key: expect.stringMatching(/^agent-signal\.run\.scope\.[\w.-]+$/),
        parallelism: 1,
      });
      say(
        `        delay queue: +${env.queued[0].delay}ms -> ${env.queued[0].endpoint} flowControl=${JSON.stringify(env.queued[0].flowControl)}`,
      );
      // The classifier scored it but, in shadow, nothing was blocked.
      expect(verdictOf(found[2], 'bot-wake:classifier')).toMatchObject({
        confidence: 0.2,
        mode: 'shadow',
        verdict: 'deny',
      });
      const traced = env.llm.calls.at(-1)!;
      expect(traced.options.tracing.scenario).toBe('bot_wake_classifier');
      expect(traced.payload.messages[1].content).toContain('Only answer questions about deploys.');
      say(
        `        classifier shadow score 0.2 (chitchat) traced as scenario=${traced.options.tracing.scenario}; custom instruction reached the prompt`,
      );

      // 4. Too early: the flush must not start a run before the 20s collect window ends.
      at(70);
      await handleWakeFlush(flushPayload(), loadSettings);
      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      say('[t+70s] early flush (10s into the 20s window) -> no run');

      // 5. A second keyword message lands while collecting: joins the same batch.
      at(75);
      await subscribed(
        thread(BOT_THREAD_ID),
        message('m4', 'deploy is blocked on review', {
          author: { isBot: false, userId: 'bob-id', userName: 'bob' },
        }),
      );
      found = await settle(4);
      say(`[t+75s] second 'deploy' while collecting -> ${describeRow(found[3])}`);
      expect(found[3]).toMatchObject({ outcome: 'defer' });

      // 6. The window ends: exactly one run starts for the channel and the batch passes through.
      at(80);
      await handleWakeFlush(flushPayload(), loadSettings);
      await handleWakeFlush(flushPayload(), loadSettings); // a redelivered flush
      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(2); // m3 and m4 replayed once each
      expect(
        mockHandleSubscribedMessage.mock.calls.every((c) => c[2].wakeKind === 'followup'),
      ).toBe(true);
      say(
        '[t+80s] flush at the 20s mark (+ a redelivered flush) -> ONE run: batch [m3,m4] released and replayed as followup wakes',
      );
      const schedulerKey = `${redisPrefix}:bot-wake:scheduler:v1:${CHANNEL_KEY}`;
      say(
        `        scheduler state = ${(await redis.get(schedulerKey))?.replace(/"pending":\[[^\]]*\]/, '"pending":[…]')}`,
      );
      expect(JSON.parse((await redis.get(schedulerKey))!).phase).toBe('running');

      // 7. A third keyword message during the run is held: never two runs in one channel.
      at(85);
      await subscribed(
        thread(BOT_THREAD_ID),
        message('m5', 'also the deploy checklist', {
          author: { isBot: false, userId: 'bob-id', userName: 'bob' },
        }),
      );
      await settle(5);
      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(2);
      say('[t+85s] third keyword while the run is in flight -> held (no parallel run)');

      // 8. The bot speaks in its thread: run done -> cooldown, window opens on channel AND thread keys.
      at(90);
      await recordWakeRunOutcome({
        applicationId: APP_ID,
        platform: 'discord',
        platformThreadId: BOT_THREAD_ID,
        settings,
        spoke: true,
        wakeKind: 'followup',
      });
      for (const key of [CHANNEL_KEY, THREAD_KEY]) {
        expect(await field(key, 'botLastSpokeAt')).toBe(String(clock + 90_000));
        expect(await field(key, 'followupUntil')).toBe(String(clock + 90_000 + 300_000));
        expect(await field(key, 'silentWakes')).toBe('0');
        say(
          `        redis ${key}: botLastSpokeAt=${await field(key, 'botLastSpokeAt')} followupUntil=${await field(key, 'followupUntil')} silentWakes=0`,
        );
      }
      expect(JSON.parse((await redis.get(schedulerKey))!)).toMatchObject({
        cooldownUntil: clock + 150_000,
        phase: 'cooldown',
      });
      say('[t+90s] bot spoke -> run done, cooldown until t+150s (60s)');

      // 9. Cooldown: a flush at +149s starts nothing; at +150s the held message runs.
      at(149);
      await handleWakeFlush(flushPayload(), loadSettings);
      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(2);
      at(150);
      await handleWakeFlush(flushPayload(), loadSettings);
      // m5 was held during the run; it was collected from t+85s, so its 20s minimum has passed.
      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(3);
      say(
        '[t+149s] flush inside cooldown -> no run; [t+150s] cooldown over -> second run starts with the held message',
      );

      // 10. Follow-up window: a plain reply in the channel AND in the thread are inside it.
      at(160);
      await catchAll(thread(CHANNEL_THREAD_ID), message('m6', 'and what about the rollback plan?'));
      await subscribed(thread(BOT_THREAD_ID), message('m7', 'yes, the rollback plan please'));
      found = await settle(8);
      const m6 = found.find((row) => row.text === 'and what about the rollback plan?')!;
      const m7 = found.find((row) => row.text === 'yes, the rollback plan please')!;
      say(`[t+160s] reply in CHANNEL -> ${describeRow(m6)}`);
      say(`[t+160s] reply in THREAD  -> ${describeRow(m7)}`);
      expect(verdictOf(m6, 'bot-wake:owner-rules')).toMatchObject({
        reason: 'inside-followup-window',
        verdict: 'allow',
      });
      expect(verdictOf(m7, 'bot-wake:owner-rules')).toMatchObject({
        reason: 'inside-followup-window',
        verdict: 'allow',
      });

      // 11. Budget: three wakes without the bot speaking -> silent; speaking resets it.
      for (let i = 0; i < 3; i++) {
        await recordWakeRunOutcome({
          applicationId: APP_ID,
          platform: 'discord',
          platformThreadId: BOT_THREAD_ID,
          settings,
          spoke: false,
          wakeKind: 'followup',
        });
      }
      expect(await field(THREAD_KEY, 'silentWakes')).toBe('3');
      at(170);
      await catchAll(thread(CHANNEL_THREAD_ID), message('m8', 'any news on the rollback plan?'));
      found = await settle(9);
      const m8 = found.find((row) => row.text === 'any news on the rollback plan?')!;
      say(`[t+170s] 3 silent wakes recorded (silentWakes=3) -> ${describeRow(m8)}`);
      expect(verdictOf(m8, 'bot-wake:owner-rules')).toMatchObject({
        reason: 'budget-exhausted',
        verdict: 'deny',
      });
      await recordWakeRunOutcome({
        applicationId: APP_ID,
        platform: 'discord',
        platformThreadId: BOT_THREAD_ID,
        settings,
        spoke: true,
        wakeKind: 'followup',
      });
      expect(await field(THREAD_KEY, 'silentWakes')).toBe('0');
      say('        bot speaks again -> silentWakes reset to 0');

      // 12. Owner presence: the owner just spoke, so a colleague chiming in is suppressed.
      at(200);
      await catchAll(
        thread(CHANNEL_THREAD_ID),
        message('m9', 'I will take it', {
          author: { isBot: false, userId: OWNER, userName: 'owner' },
        }),
      );
      // Recording is fire-and-forget; in production the two messages are seconds apart, so the
      // owner's message is always on record before the next one is judged. Say so here too.
      await settle(10);
      at(210);
      await catchAll(thread(CHANNEL_THREAD_ID), message('m10', 'sounds good to me, thanks'));
      found = await settle(11);
      const m10 = found.find((row) => row.text === 'sounds good to me, thanks')!;
      say(`[t+210s] owner spoke 10s ago -> ${describeRow(m10)}`);
      expect(verdictOf(m10, 'bot-wake:owner-rules')).toMatchObject({
        reason: 'owner-present',
        verdict: 'deny',
      });

      // 13. The model hangs: at 2s the classifier fails open (allow) and the message is untouched.
      at(400);
      env.llm.mode = 'hang';
      await catchAll(thread(CHANNEL_THREAD_ID), message('m11', 'is the staging deploy healthy?'));
      found = await settle(12);
      const m11 = found.find((row) => row.text === 'is the staging deploy healthy?')!;
      say(`[t+400s] model never answers -> ${describeRow(m11)}`);
      expect(verdictOf(m11, 'bot-wake:classifier')).toMatchObject({
        confidence: 0,
        mode: 'shadow',
        reason: 'classifier-timeout',
        verdict: 'allow',
      });
      say(
        '\n# Raw signal_decisions.verdicts of the scheduled keyword follow-up (row 3) and of the classifier-timeout row:',
      );
      say(
        JSON.stringify(
          found.find((row) => row.text === 'should we deploy now?')!.verdicts,
          null,
          1,
        ),
      );
      say(JSON.stringify(m11.verdicts, null, 1));
      say(
        '\n# Shadow guarantee: every shadow verdict above was recorded; mockHandleMention/SubscribedMessage calls were decided by the legacy router + scheduler only.',
      );
    }, 30_000);
  },
);
