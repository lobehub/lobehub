// @vitest-environment node
import { writeFileSync } from 'node:fs';

import {
  agents,
  signalDecisionLabels,
  signalDecisions,
  signals,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBotProviderConnectConfig } from '../../gateway/gatewayMapping';
import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockGetAgentRuntimeRedisClient,
  mockGetBotFeatureAccessState,
  mockGetServerDB,
  resetBotMessageRouterMocks,
} from './testUtils';

/**
 * Mock-Discord acceptance for the bot-wake pipeline.
 *
 * The Discord side is a recording fake of the gateway and the REST API:
 * - gateway: `GATEWAY_MESSAGE_CREATE` events are POSTed to the router's real webhook handler,
 *   exactly as the message gateway forwards them (`x-discord-gateway-token` header);
 * - REST: `globalThis.fetch` answers `https://discord.com/api/v10/*` (auto-thread creation,
 *   send / edit / delete message, typing, reactions) and records every call.
 *
 * Real: `chat` SDK, `@chat-adapter/discord` adapter (mention / thread resolution), the Discord
 * platform client + REST wrapper, `BotMessageRouter`, `AgentBridgeService` in local mode, the
 * bot-wake recorder, policies and scheduler, the Redis wake state, and the `signal_decisions`
 * rows (test Postgres).
 * Faked: Discord itself, the agent run (`AiAgentService.execAgent` fires the bridge hooks with
 * a scripted outcome), the classifier model, QStash, topic lookups.
 *
 * NOT verified here: the real message-gateway service (it lives outside this repo) and a real
 * Discord connection. Whether the real gateway forwards un-mentioned channel messages once
 * `messageMonitoring.enabled` is true is its own contract.
 *
 * Skipped unless BOT_WAKE_REAL_REDIS_URL points at a disposable Redis.
 */
const { redisPrefix, redisUrl } = vi.hoisted(() => {
  const url = process.env.BOT_WAKE_REAL_REDIS_URL;
  const prefix = `botwake-mockdiscord-${Date.now()}`;
  if (url) {
    process.env.REDIS_URL = url;
    process.env.REDIS_PREFIX = prefix;
  }

  return { redisPrefix: prefix, redisUrl: url };
});

const env = vi.hoisted(() => ({
  agentRuns: [] as any[],
  classifier: { calls: [] as any[], score: 0.1 },
  /** Decision rows that existed when the current inbound message was sent. */
  rowsBefore: 0,
  /** What the next scripted agent run does once `execAgent` has returned. */
  nextRun: { onComplete: { lastAssistantContent: 'ok', reason: 'done' } } as {
    afterStep?: Record<string, any>[];
    onComplete: Record<string, any>;
  },
}));

const mockExecAgent = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class LocalQueueServiceImpl {},
  isQueueAgentRuntimeEnabled: () => false,
}));
vi.mock('@/server/services/queue', () => ({
  QueueService: class {
    getImpl() {
      return {};
    }
    isLocalExecution() {
      return true;
    }
    async scheduleMessage() {
      return 'queued';
    }
  },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: async () => ({
    generateObject: async (payload: any) => {
      env.classifier.calls.push(payload);

      return {
        addressedToBot: env.classifier.score,
        kind: env.classifier.score >= 0.5 ? 'request' : 'chitchat',
        reason: 'scripted',
      };
    },
  }),
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
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'http://localhost:3010', INTERNAL_APP_URL: '' },
}));
// The legacy `bot.message.merged` signal emission needs QStash; it is fire-and-forget.
vi.mock('@/server/services/agentSignal', () => ({ emitAgentSignalSourceEvent: vi.fn() }));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      findById: vi
        .fn()
        .mockResolvedValue({ agentId: 'wake-md-agent', id: 'topic-1', updatedAt: new Date() }),
      isRunningOperationAlive: vi.fn().mockResolvedValue(false),
      update: vi.fn(),
    };
  }),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserSettings: vi.fn().mockResolvedValue({ general: { timezone: 'UTC' } }) };
  }),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return {
      execAgent: mockExecAgent,
      interruptTask: vi.fn().mockResolvedValue({ success: true }),
    };
  }),
}));
vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  getMessageGatewayClient: vi.fn().mockReturnValue({ isConfigured: false, isEnabled: false }),
}));
vi.mock('@/server/services/systemAgent', () => ({
  SystemAgentService: vi.fn().mockImplementation(function () {
    return { generateTopicTitle: vi.fn() };
  }),
}));
vi.mock('@/server/services/messenger/MessengerRouter', () => ({
  getMessengerRouter: () => ({ replayDeferredMessages: vi.fn() }),
}));
vi.mock('@/server/services/messenger/platforms', () => ({
  messengerPlatformRegistry: { getPlatform: () => undefined },
}));
vi.mock('../deferredMessages', () => ({
  deferBotMessages: async () => true,
  isDeferredMessagesAvailable: () => true,
  replayDeferredBotMessages: async () => {},
}));

// ---------------------------------------------------------------- mock Discord
const GUILD = 'g1';
const CHANNEL = 'c1';
const AUTO_THREAD = 'th1';
const APP_ID = '555000111222333';
const BOT_TOKEN = 'mock-discord-bot-token';
const OWNER = 'owner-id';
const ROLE_ID = '777000';
const ALICE = { bot: false, global_name: 'Alice', id: 'alice-id', username: 'alice' };

interface RestCall {
  body?: any;
  method: string;
  path: string;
}

const discord = {
  calls: [] as RestCall[],
  nextId: 9000,
  /** The mock REST API. Anything it does not know is a 404, recorded like the rest. */
  respond(call: RestCall): { body?: unknown; status: number } {
    const { method, path } = call;
    if (method === 'POST' && /^\/channels\/[^/]+\/messages\/[^/]+\/threads$/.test(path)) {
      return {
        body: { id: AUTO_THREAD, name: call.body?.name, parent_id: CHANNEL, type: 11 },
        status: 200,
      };
    }
    if (method === 'POST' && /^\/channels\/[^/]+\/messages$/.test(path)) {
      const channelId = path.split('/')[2];

      return {
        body: {
          author: { bot: true, id: APP_ID, username: 'bot' },
          channel_id: channelId,
          content: call.body?.content ?? '',
          id: String(discord.nextId++),
          timestamp: new Date().toISOString(),
        },
        status: 200,
      };
    }
    if (method === 'PATCH' && /^\/channels\/[^/]+\/messages\/[^/]+$/.test(path)) {
      return {
        body: {
          channel_id: path.split('/')[2],
          content: call.body?.content ?? '',
          id: path.split('/')[4],
          timestamp: new Date().toISOString(),
        },
        status: 200,
      };
    }
    if (
      method === 'DELETE' ||
      method === 'PUT' ||
      (method === 'POST' && path.endsWith('/typing'))
    ) {
      return { status: 204 };
    }
    if (method === 'GET' && path === `/channels/${AUTO_THREAD}`) {
      return { body: { id: AUTO_THREAD, parent_id: CHANNEL, type: 11 }, status: 200 };
    }
    if (method === 'GET' && /\/thread-members/.test(path)) return { body: [], status: 200 };
    if (method === 'GET' && /\/messages/.test(path)) return { body: [], status: 200 };

    return { body: { code: 0, message: 'mock discord: unknown route' }, status: 404 };
  },
};

const installMockDiscordRest = () => {
  vi.stubGlobal('fetch', async (input: any, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input?.url ?? input));
    if (!url.startsWith('https://discord.com/api/v10')) {
      throw new Error(`mock discord: unexpected outbound request ${url}`);
    }
    const path = decodeURI(url.slice('https://discord.com/api/v10'.length)).split('?')[0];
    const call: RestCall = {
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      method: init?.method ?? 'GET',
      path,
    };
    discord.calls.push(call);
    const { body, status } = discord.respond(call);

    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      headers: { 'content-type': 'application/json' },
      status,
    });
  });
};

/** A `MESSAGE_CREATE` the way the gateway forwards it to the webhook. */
const gatewayMessageCreate = (data: Record<string, unknown>) =>
  new Request(`http://localhost:3010/api/agent/webhooks/discord/${APP_ID}`, {
    body: JSON.stringify({
      data: {
        attachments: [],
        author: ALICE,
        channel_id: CHANNEL,
        content: '',
        guild_id: GUILD,
        mention_everyone: false,
        mention_roles: [],
        mentions: [],
        timestamp: new Date().toISOString(),
        type: 0,
        ...data,
      },
      timestamp: Date.now(),
      type: 'GATEWAY_MESSAGE_CREATE',
    }),
    headers: { 'content-type': 'application/json', 'x-discord-gateway-token': BOT_TOKEN },
    method: 'POST',
  });

// ---------------------------------------------------------------- the suite
const run = redisUrl ? describe : describe.skip;

const SETTINGS = {
  botWake: {
    classifier: { mode: 'shadow' },
    enabled: true,
    mode: 'shadow',
    rules: { maxSilentWakes: 3, ownerPresenceSeconds: 0, windowSeconds: 300 },
  },
  dmPolicy: 'open',
  userId: OWNER,
  watchKeywords: [{ instruction: '', keyword: 'deploy' }],
};

run('mock Discord gateway + REST drive the real router, bridge and bot-wake pipeline', () => {
  let testDb: Awaited<ReturnType<typeof getTestDB>>;
  let redis: IORedis;
  let router: BotMessageRouter;
  let webhook: (req: Request) => Promise<Response>;
  const transcript: string[] = [];
  /** Machine-readable record of the no_reply scenario, written when MOCK_DISCORD_EVIDENCE is set. */
  const evidence: Record<string, unknown> = {};
  const say = (line: string) => transcript.push(line);
  const userId = 'wake-md-user';
  const agentId = 'wake-md-agent';

  const rows = async () =>
    testDb
      .select({
        externalId: signals.externalId,
        finalReason: signalDecisions.finalReason,
        id: signalDecisions.id,
        outcome: signalDecisions.outcome,
        text: sql<string>`${signals.payload}->>'text'`,
        verdicts: signalDecisions.verdicts,
      })
      .from(signalDecisions)
      .innerJoin(signals, sql`${signals.id} = ${signalDecisions.signalId}`)
      .orderBy(signalDecisions.createdAt);

  /** Wake state (own prefix) and the chat SDK's dedupe / subscription state for this agent. */
  const clearRedis = async () => {
    const keys = [
      ...(await redis.keys(`${redisPrefix}:*`)),
      ...(await redis.keys(`chat-sdk:agent-${agentId}*`)),
    ];
    if (keys.length > 0) await redis.del(...keys);
  };

  const until = async <T>(read: () => Promise<T> | T, done: (value: T) => boolean, ms = 8000) => {
    const start = Date.now();
    let value = await read();
    while (!done(value) && Date.now() - start < ms) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      value = await read();
    }

    return value;
  };

  const rowFor = async (text: string) =>
    (await until(rows, (found) => found.some((row) => row.text === text))).find(
      (row) => row.text === text,
    )!;

  const verdictOf = (row: Awaited<ReturnType<typeof rows>>[number], policyId: string) =>
    (row.verdicts as any[]).find((verdict) => verdict.policyId === policyId);

  const describeRow = (row: Awaited<ReturnType<typeof rows>>[number]) =>
    `${row.outcome}/${row.finalReason} ` +
    (row.verdicts as any[])
      .map((v) => `${v.policyId}[${v.mode}]=${v.verdict}(${v.reason})`)
      .join(' ');

  const showCalls = (label: string, calls: RestCall[]) => {
    say(`${label}: ${calls.length} Discord REST call(s)`);
    for (const call of calls) {
      const body = call.body ? ` ${JSON.stringify(call.body).slice(0, 110)}` : '';
      say(`    ${call.method} ${call.path}${body}`);
    }
  };

  /** Calls recorded since `from`, split into the kinds a silent run must not leave behind. */
  const residue = (calls: RestCall[]) => ({
    editsOrDeletes: calls.filter(
      (call) => /^\/channels\/[^/]+\/messages\/[^/]+$/.test(call.path) && call.method !== 'GET',
    ),
    messages: calls.filter((call) => call.method === 'POST' && /\/messages$/.test(call.path)),
    reactions: calls.filter((call) => /\/reactions\//.test(call.path)),
    typing: calls.filter((call) => call.path.endsWith('/typing')),
  });

  /** Fire a message through the gateway→webhook seam and wait for the agent run to settle. */
  const send = async (data: Record<string, unknown>) => {
    const from = discord.calls.length;
    const runsBefore = env.agentRuns.length;
    env.rowsBefore = (await rows()).length;
    const response = await webhook(gatewayMessageCreate(data));
    expect(response.status).toBe(200);

    return { from, runsBefore };
  };

  const settleRun = async (runsBefore: number) => {
    await until(
      () => env.agentRuns.length,
      (n) => n > runsBefore,
    );
    // The scripted hooks fire on the next macrotask; wait for the REST traffic to stop.
    let last = -1;
    await until(
      () => discord.calls.length,
      (n) => {
        const stable = n === last;
        last = n;

        return stable;
      },
      3000,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  const quiet = async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  };

  beforeAll(async () => {
    testDb = await getTestDB();
    // The chat SDK keeps its subscription / dedupe state in the same Redis as production.
    redis = new IORedis(redisUrl!);
    await clearRedis();
    installMockDiscordRest();
    mockExecAgent.mockImplementation(async (params: any) => {
      env.agentRuns.push(params);
      const script = env.nextRun;
      const hook = (id: string) => params.hooks.find((h: any) => h.id === id);
      setTimeout(async () => {
        // A real run takes seconds; the wake decision is recorded fire-and-forget just before it
        // starts. Let the scripted run finish only once that row exists, as it would in life.
        await until(rows, (found) => found.length > env.rowsBefore);
        for (const event of script.afterStep ?? []) await hook('bot-step-progress').handler(event);
        await hook('bot-completion').handler({ operationId: 'op-md', ...script.onComplete });
      }, 0);

      return {
        assistantMessageId: 'assistant-md',
        createdAt: new Date().toISOString(),
        operationId: 'op-md',
        success: true,
        topicId: 'topic-1',
      };
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await clearRedis();
    redis.disconnect();
    await testDb.delete(users);
    if (process.env.MOCK_DISCORD_EVIDENCE) {
      writeFileSync(process.env.MOCK_DISCORD_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
    }
    if (process.env.MOCK_DISCORD_TRANSCRIPT) {
      writeFileSync(process.env.MOCK_DISCORD_TRANSCRIPT, transcript.join('\n') + '\n');
    }
    console.log(`\n${transcript.join('\n')}`);
  });

  beforeEach(() => {
    resetBotMessageRouterMocks();
    mockGetServerDB.mockResolvedValue(testDb);
    mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });
    mockGetAgentRuntimeRedisClient.mockReturnValue(redis);
  });

  it('runs @bot, shadow follow-up, no_reply, role / @everyone and gateway capability scenarios', async () => {
    await testDb.delete(users);
    await testDb.insert(users).values({ id: userId });
    await testDb.insert(agents).values({ id: agentId, userId });
    const provider = makeProvider({
      agentId,
      applicationId: APP_ID,
      credentials: { botToken: BOT_TOKEN, publicKey: 'a'.repeat(64) },
      settings: SETTINGS,
      userId,
    });
    mockFindEnabledByPlatform.mockResolvedValue([provider]);
    router = new BotMessageRouter();
    webhook = router.getWebhookHandler('discord', APP_ID);

    say('# MOCK DISCORD ACCEPTANCE — Discord side is MOCK; real gateway forwarding is UNVERIFIED');
    say(
      '# real: chat SDK + @chat-adapter/discord + Discord client/REST wrapper + BotMessageRouter + AgentBridgeService(local) + bot-wake pipeline + Redis wake state + signal_decisions (Postgres)',
    );
    say(
      '# fake: Discord gateway events (POSTed to the real webhook handler), Discord REST (fetch stub), the agent run (scripted hooks), classifier model',
    );
    say(
      `# settings: botWake enabled, rules shadow, classifier shadow, scheduler default(off); watch keyword "deploy"; guild ${GUILD} channel ${CHANNEL}; bot app ${APP_ID}\n`,
    );

    // ---- 5. gateway capability: a passive-listening rule flips messageMonitoring.enabled ----
    const connect = (settings: Record<string, unknown>) =>
      buildBotProviderConnectConfig({
        connectionMode: 'webhook',
        platform: 'discord',
        provider: { ...provider, id: 'prov-1', settings } as any,
      } as any).capabilities;
    const noRules = connect({ dmPolicy: 'open' });
    const botWakeOnly = connect({ botWake: { enabled: true } });
    const keywordOnly = connect({ watchKeywords: [{ instruction: '', keyword: 'deploy' }] });
    const configured = connect(SETTINGS);
    say(
      '## S5 gateway capability (buildBotProviderConnectConfig → connect payload sent to the gateway)',
    );
    say(`    no passive rule            -> ${JSON.stringify(noRules)}`);
    say(`    botWake.enabled only       -> ${JSON.stringify(botWakeOnly)}`);
    say(`    watch keyword only         -> ${JSON.stringify(keywordOnly)}`);
    say(`    this run's settings        -> ${JSON.stringify(configured)}\n`);
    expect(noRules).toEqual({ messageMonitoring: { enabled: false } });
    expect(botWakeOnly).toEqual({ messageMonitoring: { enabled: true } });
    expect(keywordOnly).toEqual({ messageMonitoring: { enabled: true } });
    expect(configured).toEqual({ messageMonitoring: { enabled: true } });

    // ---- 1. @bot: the legacy path ----
    env.nextRun = {
      afterStep: [{ shouldContinue: true, stepType: 'call_tool', toolsCalling: [{}] }],
      onComplete: { lastAssistantContent: 'The build is green.', reason: 'done' },
    };
    let { from, runsBefore } = await send({
      content: `<@${APP_ID}> is the build green?`,
      id: 'm100',
      mentions: [{ bot: true, id: APP_ID, username: 'bot' }],
    });
    await settleRun(runsBefore);
    const mentionCalls = discord.calls.slice(from);
    say('## S1 @bot in the channel (mentions[] contains the bot) — legacy path');
    showCalls('    REST', mentionCalls);
    const mentionRow = await rowFor(`<@${APP_ID}> is the build green?`);
    say(`    decision: ${describeRow(mentionRow)}`);
    say(
      `    execAgent calls: ${env.agentRuns.length - runsBefore}, botPlatformContext.wakeKind=${JSON.stringify(env.agentRuns.at(-1).botPlatformContext?.wakeKind)}\n`,
    );
    expect(mentionCalls[0]).toMatchObject({
      method: 'POST',
      path: `/channels/${CHANNEL}/messages/m100/threads`,
    });
    expect(env.agentRuns.length - runsBefore).toBe(1);
    expect(env.agentRuns.at(-1).botPlatformContext?.wakeKind).toBeUndefined();
    const mentionKinds = residue(mentionCalls);
    // Immediate feedback, exactly as before: typing + a progress message that is then edited
    // into the final reply. (Discord's messenger has no `replaceReaction`, so the bridge's
    // optional-chained reaction swap never reaches REST on Discord, before or after this change.)
    expect(mentionKinds.typing.length).toBeGreaterThan(0);
    expect(mentionKinds.messages.length).toBeGreaterThan(0);
    expect(
      mentionCalls.some(
        (call) =>
          call.method === 'PATCH' && JSON.stringify(call.body).includes('The build is green.'),
      ),
    ).toBe(true);
    expect(mentionRow).toMatchObject({ finalReason: 'explicit-mention', outcome: 'wake' });
    expect(verdictOf(mentionRow, 'legacy-router')).toMatchObject({
      mode: 'enforce',
      verdict: 'allow',
    });
    await quiet();

    // ---- 2. follow-up in shadow: classifier says "not for the bot", the bot is still woken ----
    env.classifier.score = 0.1;
    env.nextRun = { onComplete: { lastAssistantContent: 'NO_REPLY:off_topic', reason: 'done' } };
    ({ from, runsBefore } = await send({
      author: { ...ALICE, id: 'bob-id', username: 'bob' },
      channel_id: AUTO_THREAD,
      channel_type: 11,
      content: 'should we deploy now?',
      id: 'm101',
    }));
    await settleRun(runsBefore);
    const followupCalls = discord.calls.slice(from);
    const followupRow = await rowFor('should we deploy now?');
    say(
      '## S2 + S3 follow-up in the bot thread, classifier scores 0.1 (would deny) in SHADOW; agent answers NO_REPLY:off_topic',
    );
    showCalls('    REST (everything Discord saw for this message)', followupCalls);
    say(`    decision: ${describeRow(followupRow)}`);
    say(
      `    execAgent calls: ${env.agentRuns.length - runsBefore}, botPlatformContext.wakeKind=${JSON.stringify(env.agentRuns.at(-1).botPlatformContext?.wakeKind)}`,
    );
    expect(env.classifier.calls.length).toBeGreaterThan(0);
    expect(env.agentRuns.length - runsBefore).toBe(1); // shadow: the deny did not block the wake
    expect(env.agentRuns.at(-1).botPlatformContext?.wakeKind).toBe('followup');
    expect(followupRow).toMatchObject({ finalReason: 'watch-keyword', outcome: 'wake' });
    expect(verdictOf(followupRow, 'bot-wake:classifier')).toMatchObject({
      confidence: 0.1,
      mode: 'shadow',
      verdict: 'deny',
    });
    expect(verdictOf(followupRow, 'legacy-router')).toMatchObject({
      mode: 'enforce',
      verdict: 'allow',
    });
    // S3: silence leaves nothing in Discord.
    const silent = residue(followupCalls);
    say(
      `    residue: messages=${silent.messages.length} typing=${silent.typing.length} reactions=${silent.reactions.length} editsOrDeletes=${silent.editsOrDeletes.length}`,
    );
    expect(followupCalls.filter((call) => call.method !== 'GET')).toEqual([]);
    expect(silent).toEqual({ editsOrDeletes: [], messages: [], reactions: [], typing: [] });
    // The silence is written onto the wake decision.
    const labels = await until(
      () =>
        testDb
          .select({
            label: signalDecisionLabels.label,
            metadata: signalDecisionLabels.metadata,
            source: signalDecisionLabels.source,
          })
          .from(signalDecisionLabels)
          .where(sql`${signalDecisionLabels.decisionId} = ${followupRow.id}`),
      (found) => found.length > 0,
    );
    say(`    signal_decision_labels for this decision: ${JSON.stringify(labels)}\n`);
    expect(labels).toEqual([
      {
        label: 'false_wake',
        metadata: { reason: 'off_topic', surface: 'agent' },
        source: 'agent:no_reply',
      },
    ]);
    evidence.noReply = {
      allDiscordRestCallsForThisMessage: followupCalls,
      decision: {
        finalReason: followupRow.finalReason,
        outcome: followupRow.outcome,
        verdicts: followupRow.verdicts,
      },
      execAgentWakeKind: env.agentRuns.at(-1).botPlatformContext?.wakeKind,
      labels,
      residue: silent,
      scenario: 'follow-up wake in the bot thread; agent final text is NO_REPLY:off_topic',
    };
    await quiet();

    // ---- control: the same wake, but the agent acts and answers — the mock does see residue ----
    env.nextRun = {
      afterStep: [{ shouldContinue: true, stepType: 'call_tool', toolsCalling: [{}] }],
      onComplete: { lastAssistantContent: 'Deploys are frozen until Monday.', reason: 'done' },
    };
    ({ from, runsBefore } = await send({
      channel_id: AUTO_THREAD,
      channel_type: 11,
      content: 'any news on the deploy?',
      id: 'm102',
    }));
    await settleRun(runsBefore);
    const controlCalls = discord.calls.slice(from);
    const control = residue(controlCalls);
    say(
      '## control: follow-up where the agent acts and answers (proves the mock would show residue)',
    );
    showCalls('    REST', controlCalls);
    expect(control.typing.length).toBeGreaterThan(0);
    expect(control.messages.length).toBeGreaterThan(0);
    expect(control.editsOrDeletes.length).toBeGreaterThan(0);
    say('');
    await quiet();

    // ---- 4. role mention and @everyone are not a wake ----
    const beforeBroadcast = env.agentRuns.length;
    ({ from } = await send({
      content: `<@&${ROLE_ID}> lunch anyone?`,
      id: 'm103',
      mention_roles: [ROLE_ID],
    }));
    await quiet();
    const roleRow = await rowFor(`<@&${ROLE_ID}> lunch anyone?`);
    const roleCalls = discord.calls.slice(from);
    say('## S4a role mention (gateway forwards mention_roles=[role], no is_mention)');
    showCalls('    REST', roleCalls);
    say(`    decision: ${describeRow(roleRow)}`);
    expect(roleCalls).toEqual([]);
    expect(env.agentRuns.length).toBe(beforeBroadcast);
    expect(roleRow).toMatchObject({ finalReason: 'not-addressed', outcome: 'skip' });

    ({ from } = await send({
      content: '@everyone standup in 5',
      id: 'm104',
      mention_everyone: true,
    }));
    await quiet();
    const everyoneRow = await rowFor('@everyone standup in 5');
    const everyoneCalls = discord.calls.slice(from);
    say('## S4b @everyone (gateway forwards mention_everyone=true, no is_mention)');
    showCalls('    REST', everyoneCalls);
    say(`    decision: ${describeRow(everyoneRow)}`);
    expect(everyoneCalls).toEqual([]);
    expect(env.agentRuns.length).toBe(beforeBroadcast);
    expect(everyoneRow).toMatchObject({ finalReason: 'not-addressed', outcome: 'skip' });

    // If the forwarder flags a broadcast as a mention (`is_mention`), the adapter's flag still
    // drives the legacy path, so in shadow the bot is woken; the pipeline's verdict records that
    // a broadcast is not an explicit @bot.
    await send({
      content: '@everyone release notes are up',
      id: 'm105',
      is_mention: true,
      mention_everyone: true,
    });
    await quiet();
    const flaggedRow = await rowFor('@everyone release notes are up');
    say('## S4c @everyone but the forwarder flagged is_mention=true (defence in depth)');
    say(`    decision: ${describeRow(flaggedRow)}`);
    say(
      `    execAgent calls: ${env.agentRuns.length - beforeBroadcast} (shadow mode: the legacy path still runs; the verdict is recorded, not enforced)`,
    );
    expect(verdictOf(flaggedRow, 'bot-wake:internal-rules')).toMatchObject({
      reason: 'broadcast-mention',
      verdict: 'deny',
    });
    say('\n# Raw signal_decisions rows written by this run:');
    for (const row of await rows()) {
      say(
        JSON.stringify({
          externalId: row.externalId,
          finalReason: row.finalReason,
          outcome: row.outcome,
          text: row.text,
          verdicts: row.verdicts,
        }),
      );
    }
    void redisPrefix;
  }, 60_000);
});
