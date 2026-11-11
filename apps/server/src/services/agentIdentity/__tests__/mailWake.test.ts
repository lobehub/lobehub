// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentMailModel } from '@/database/models/agentMail';
import {
  agentAccounts,
  agentInboxMessages,
  agents,
  signalDecisions,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type * as AgentIdentityProviders from '../providers';

/**
 * The mail wake rules and the digest, over the real webhook route.
 *
 * Real: the Hono routes, signature verification, the Drizzle models on PGlite,
 * the wake rules and the digest flush. Faked, and named:
 *  - the Agent Mail SaaS (a loopback server serving the message details);
 *  - `AiAgentService.execAgent`, which would call an LLM — the fake records
 *    every run it is asked to start;
 *  - the job queue, so a test decides whether QStash is configured and sees
 *    every flush the digest books;
 *  - the QStash signature check on the flush route.
 */

const holder = vi.hoisted(() => ({ db: undefined as unknown as LobeChatDatabase }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => holder.db }));

const runs = vi.hoisted(() => [] as Array<{ params: any; userId: string }>);
const runFailure = vi.hoisted(() => ({ next: undefined as string | undefined }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    private readonly db: any;
    private readonly userId: string;
    constructor(db: unknown, userId: string) {
      this.db = db;
      this.userId = userId;
    }
    async execAgent(params: any) {
      runs.push({ params, userId: this.userId });
      if (runFailure.next) {
        const error = runFailure.next;
        runFailure.next = undefined;
        return { error };
      }
      const topicId = params.appContext?.topicId ?? `tpc_mail_wake_${runs.length}`;
      const { topics } = await import('@/database/schemas');
      await this.db
        .insert(topics)
        .values({ id: topicId, userId: this.userId })
        .onConflictDoNothing();
      return { operationId: `op_${runs.length}`, topicId };
    }
  },
}));

const queue = vi.hoisted(() => ({ failNext: 0, local: false, scheduled: [] as any[] }));
vi.mock('@/server/services/queue', () => ({
  QueueService: class {
    isLocalExecution() {
      return queue.local;
    }
    async scheduleMessage(message: any) {
      if (queue.failNext > 0) {
        queue.failNext -= 1;
        throw new Error('queue unavailable');
      }
      queue.scheduled.push(message);
      return `msg_${queue.scheduled.length}`;
    }
  },
}));

const qstash = vi.hoisted(() => ({ valid: true }));
vi.mock('@/libs/qstash', () => ({ verifyQStashSignature: async () => qstash.valid }));

let mockBaseUrl = '';
const claims = vi.hoisted(() => ({ store: undefined as any }));

vi.mock('../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentIdentityProviders>();
  return {
    ...actual,
    createDefaultAgentAccountRegistry: () =>
      actual.createAgentAccountRegistry({
        agentMail: { apiBaseUrl: mockBaseUrl, apiKey: 'am_wake_test', dedupeStore: claims.store },
      }),
  };
});

const { default: agentApp } = await import('@/server/router-hono/agent');
const { MAIL_WAKE_PIPELINE_VERSION } = await import('../wake/policies');
const { INBOUND_WAKE_LIMITS } = await import('../inbound');

const serverDB: LobeChatDatabase = await getTestDB();
holder.db = serverDB;

const userId = 'mail-wake-user';
const agentId = 'mail-wake-agent';
const ADDRESS = 'arvin-agent@lobe.id';
const WEBHOOK_SECRET = 'whsec_mail_wake';

interface MailFixture {
  from: string;
  messageId: string;
  references?: string[];
  subject: string;
}

/** Message details the loopback provider serves, by provider message id. */
const mails = new Map<string, MailFixture>();

const detailOf = (id: string) => {
  const mail = mails.get(id);
  if (!mail) return undefined;

  return {
    attachments: [],
    bcc: [],
    cc: [],
    codes: [],
    direction: 'inbound' as const,
    envelope: { from: mail.from, to: ADDRESS },
    error: null,
    from: { address: mail.from },
    html: null,
    id,
    inboxId: 'inb_wake',
    inReplyTo: mail.references?.at(-1) ?? null,
    links: [],
    messageId: mail.messageId,
    read: false,
    receivedAt: new Date().toISOString(),
    references: mail.references ?? [],
    replyTo: [],
    size: 64,
    snippet: null,
    status: 'received',
    subject: mail.subject,
    text: `Body of ${mail.subject}`,
    to: [{ address: ADDRESS }],
  };
};

let mockServer: ReturnType<typeof createServer>;
let accountId = '';

beforeAll(async () => {
  vi.stubEnv('KEY_VAULTS_SECRET', Buffer.alloc(32, 7).toString('base64'));

  mockServer = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (method === 'POST' && pathname === '/v1/inboxes')
        return json(200, { address: ADDRESS, clientId: 'cli_wake', id: 'inb_wake' });
      if (method === 'POST' && pathname === '/v1/webhooks')
        return json(200, { id: 'wh_wake', secret: WEBHOOK_SECRET, url: 'http://127.0.0.1/hook' });
      const match = /^\/v1\/messages\/([^/]+)$/.exec(pathname);
      const detail = match && method === 'GET' ? detailOf(match[1]) : undefined;
      if (detail) return json(200, detail);
      return json(404, { error: { message: `unexpected ${method} ${pathname}` } });
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mockBaseUrl = `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    mockServer.close((error) => (error ? reject(error) : resolve())),
  );
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  runs.length = 0;
  runFailure.next = undefined;
  queue.local = false;
  queue.failNext = 0;
  queue.scheduled.length = 0;
  qstash.valid = true;
  mails.clear();
  const { createInMemoryLinqWebhookDedupeStore } = await import('@lobechat/agent-address-linq');
  claims.store = createInMemoryLinqWebhookDedupeStore();

  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });

  const { AgentAccountService } = await import('../index');
  const { createAgentMailProvider } = await import('../providers/agentMail');
  const { AgentAccountProviderRegistry } = await import('../registry');
  const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');

  const service = new AgentAccountService(serverDB, userId, {
    gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
    registry: new AgentAccountProviderRegistry().register(
      createAgentMailProvider({
        apiBaseUrl: mockBaseUrl,
        apiKey: 'am_wake_test',
        webhookUrl: 'http://127.0.0.1/hook',
      }),
    ),
  });
  accountId = (await service.provision({ agentId, provider: 'agent-mail' })).id;
});

afterEach(async () => {
  await serverDB.delete(agentInboxMessages);
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
});

const setWake = (wake: Record<string, unknown>) =>
  serverDB.update(agentAccounts).set({ settings: { wake } }).where(eq(agentAccounts.id, accountId));

/** Delivers one signed `message.received` for a mail served by the loopback provider. */
const deliver = async (id: string, mail: MailFixture) => {
  mails.set(id, mail);
  const body = JSON.stringify({
    createdAt: new Date().toISOString(),
    data: {
      inbox: { address: ADDRESS, clientId: 'cli_wake', id: 'inb_wake' },
      message: { id },
    },
    id: `evt_${id}`,
    type: 'message.received',
  });
  const response = await agentApp.request('/api/agent/accounts/webhooks/agent-mail', {
    body,
    headers: {
      'content-type': 'application/json',
      'x-agentmail-signature': computeAgentMailSignature(
        WEBHOOK_SECRET,
        body,
        Math.floor(Date.now() / 1000),
      ),
    },
    method: 'POST',
  });

  return { json: await response.json(), status: response.status };
};

const decisions = () =>
  serverDB
    .select()
    .from(signalDecisions)
    .where(eq(signalDecisions.pipelineVersion, MAIL_WAKE_PIPELINE_VERSION));

const inboxRows = () =>
  serverDB.select().from(agentInboxMessages).where(eq(agentInboxMessages.accountId, accountId));

const flush = (payload: Record<string, unknown>) =>
  agentApp.request('/api/agent/accounts/digest-flush', {
    body: JSON.stringify({ payload }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

describe('mail wake — the default rules', () => {
  it('holds strangers and machine senders for the digest without any setup', async () => {
    const stranger = await deliver('m_stranger', {
      from: 'pitch@growth-mate.org',
      messageId: '<pitch@growth-mate.org>',
      subject: 'LobeHub x Coupler?',
    });
    const robot = await deliver('m_robot', {
      from: 'no-reply@github.com',
      messageId: '<ci@github.com>',
      subject: 'CI failed',
    });

    expect(stranger.json.wake).toEqual({ reason: 'held-for-digest', started: false });
    expect(robot.json.wake).toEqual({ reason: 'held-for-digest', started: false });
    expect(runs).toHaveLength(0);

    const rows = await decisions();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ outcome: 'defer', scopeKey: `agent-mail:${accountId}` });
      expect(row.metadata).toMatchObject({ extra: { mode: 'on' } });
    }
    const robotRow = rows.find((row) => row.verdicts.some((v) => v.reason === 'automated-sender'));
    expect(robotRow).toMatchObject({ finalReason: 'automated-sender', toTag: 'mail-wake:rules' });
    expect(robotRow?.verdicts).toEqual([
      expect.objectContaining({ mode: 'enforce', policyId: 'mail-wake:rules', verdict: 'deny' }),
    ]);
  });
});

describe('mail wake — with listed senders', () => {
  beforeEach(async () => {
    await setWake({ digestMinutes: 30, mode: 'on', wakeSenders: ['@lobehub.com'] });
  });

  it('holds a stranger for the digest and books one flush per window', async () => {
    const first = await deliver('m_pitch_1', {
      from: 'pl@launchdriftcloud.com',
      messageId: '<p1@launchdriftcloud.com>',
      subject: 'Agent workloads',
    });
    await deliver('m_pitch_2', {
      from: 'katherine@llmapi.ai',
      messageId: '<p2@llmapi.ai>',
      subject: 'LLM API costs at LobeHub',
    });

    expect(first.status).toBe(200);
    expect(first.json.wake).toEqual({ reason: 'held-for-digest', started: false });
    expect(runs).toHaveLength(0);

    // Both bookings carry the same window, so QStash keeps one flush.
    expect(queue.scheduled).toHaveLength(2);
    const [a, b] = queue.scheduled;
    expect(a.deduplicationId).toBe(b.deduplicationId);
    expect(a.endpoint).toMatch(/\/api\/agent\/accounts\/digest-flush$/);
    expect(a.payload).toEqual({ accountId, at: expect.any(Number) });
    expect(a.payload.at % (30 * 60_000)).toBe(0);

    const rows = await inboxRows();
    expect(rows.every((row) => row.readAt === null && row.wakeClaimedAt === null)).toBe(true);
    expect((await decisions()).map((row) => row.outcome)).toEqual(['defer', 'defer']);
  });

  it('wakes at once for a listed sender', async () => {
    const result = await deliver('m_team', {
      from: 'Jianwen.Liao@lobehub.com',
      messageId: '<aws@lobehub.com>',
      subject: 'AWS migration plan',
    });

    expect(result.json.wake).toMatchObject({ reason: 'started', started: true });
    expect(runs).toHaveLength(1);
    expect(queue.scheduled).toHaveLength(0);
    expect(await decisions()).toEqual([
      expect.objectContaining({
        finalReason: 'wake-sender',
        outcome: 'wake',
        toTag: 'mail-wake:rules',
        topicId: 'tpc_mail_wake_1',
      }),
    ]);
  });

  it('wakes at once for a reply in a thread the agent wrote to that sender', async () => {
    await deliver('m_root', {
      from: 'david@communeflow.com',
      messageId: '<root@communeflow.com>',
      subject: 'Backlinks',
    });
    expect(runs).toHaveLength(0);
    const [root] = await inboxRows();

    // The agent answered the thread (with the owner's approval).
    await AgentMailModel.record(
      serverDB,
      {
        accountId,
        agentId,
        deliveredAt: new Date(),
        direction: 'outbound',
        fromAddress: ADDRESS,
        provider: 'agent-mail',
        providerMessageId: 'out_1',
        text: 'Thanks, tell me more.',
        threadKey: root.threadKey!,
        to: [{ address: 'david@communeflow.com' }],
      },
      { userId },
    );

    const reply = await deliver('m_reply', {
      from: 'david@communeflow.com',
      messageId: '<reply@communeflow.com>',
      references: ['<root@communeflow.com>'],
      subject: 'RE: Backlinks',
    });
    expect(reply.json.wake).toMatchObject({ started: true });

    // Someone else who learned the thread's key does not get the same pass.
    const outsider = await deliver('m_outsider', {
      from: 'someone@else.com',
      messageId: '<outsider@else.com>',
      references: ['<root@communeflow.com>'],
      subject: 'RE: Backlinks',
    });
    expect(outsider.json.wake).toEqual({ reason: 'held-for-digest', started: false });
    expect(runs).toHaveLength(1);
  });

  it('wakes at once when the deployment has no durable queue to hold for', async () => {
    queue.local = true;

    const result = await deliver('m_local', {
      from: 'pl@launchdriftcloud.com',
      messageId: '<local@launchdriftcloud.com>',
      subject: 'Agent workloads',
    });

    expect(result.json.wake).toMatchObject({ started: true });
    expect(queue.scheduled).toHaveLength(0);
    expect((await decisions())[0]).toMatchObject({
      finalReason: 'digest-unavailable',
      outcome: 'wake',
    });
  });
});

describe('mail wake — past the wake budget', () => {
  /** One more than the per-sender budget, all from a sender the rules would wake for. */
  const flood = async () => {
    const results = [];
    for (let i = 0; i <= INBOUND_WAKE_LIMITS.perSender; i++) {
      results.push(
        await deliver(`m_flood_${i}`, {
          from: 'ceo@lobehub.com',
          messageId: `<flood-${i}@lobehub.com>`,
          subject: `Update ${i}`,
        }),
      );
    }
    return results;
  };

  it('holds the overflow for the digest', async () => {
    await setWake({ mode: 'on', wakeSenders: ['@lobehub.com'] });

    const results = await flood();

    expect(runs).toHaveLength(INBOUND_WAKE_LIMITS.perSender);
    expect(results.at(-1)!.json.wake).toEqual({ reason: 'held-for-digest', started: false });
    expect(queue.scheduled).toHaveLength(1);
    expect((await decisions()).filter((row) => row.outcome === 'defer')).toEqual([
      expect.objectContaining({ finalReason: 'rate-limited' }),
    ]);
  });

  it('drops the overflow when the deployment has no digest', async () => {
    queue.local = true;
    await setWake({ mode: 'on', wakeSenders: ['@lobehub.com'] });

    const results = await flood();

    expect(runs).toHaveLength(INBOUND_WAKE_LIMITS.perSender);
    expect(results.at(-1)!.json.wake).toEqual({ reason: 'rate-limited', started: false });
    expect(queue.scheduled).toHaveLength(0);
    expect((await decisions()).filter((row) => row.outcome === 'skip')).toEqual([
      expect.objectContaining({ finalReason: 'rate-limited' }),
    ]);
  });
});

describe('mail wake — off', () => {
  it('keeps the message in the inbox and starts nothing', async () => {
    await setWake({ mode: 'off' });

    const result = await deliver('m_off', {
      from: 'ceo@lobehub.com',
      messageId: '<off@lobehub.com>',
      subject: 'Anything',
    });

    expect(result.json.wake).toEqual({ reason: 'wake-off', started: false });
    expect(runs).toHaveLength(0);
    expect(queue.scheduled).toHaveLength(0);
    expect(await inboxRows()).toHaveLength(1);
    expect((await decisions())[0]).toMatchObject({ outcome: 'skip', verdicts: [] });
  });
});

describe('mail digest flush', () => {
  beforeEach(async () => {
    await setWake({ mode: 'on' });
    await deliver('m_d1', {
      from: 'pl@launchdriftcloud.com',
      messageId: '<d1@launchdriftcloud.com>',
      subject: 'Agent workloads',
    });
    await deliver('m_d2', {
      from: 'hidde@tryboxd.com',
      messageId: '<d2@tryboxd.com>',
      subject: 'lobehub + boxd',
    });
  });

  it('starts one run for everything held, and a repeated flush finds nothing', async () => {
    const response = await flush(queue.scheduled[0].payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: 'started' });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      params: { agentId, appContext: { scope: 'agent' }, trigger: 'inbox' },
      userId,
    });
    const prompt: string = runs[0].params.prompt;
    const [own, , instruction, fenced] = prompt.split('\n\n');
    expect(instruction).toContain('direct Channel');
    expect(runs[0].params.userInterventionConfig).toEqual({ approvalMode: 'headless' });
    expect(runs[0].params.exclusivePluginIds).toEqual(['lobe-agent-account']);
    expect(runs[0].params.hooks).toEqual([
      expect.objectContaining({ id: `agent-inbox-report:${accountId}`, type: 'onComplete' }),
    ]);
    expect(runs[0].params.title).toBe('Agent workloads +1');
    expect(own).toContain('2 messages arrived');
    expect(own).not.toContain('launchdriftcloud');
    expect(fenced.startsWith('<untrusted_inbox>')).toBe(true);
    expect(fenced.indexOf('Agent workloads')).toBeLessThan(fenced.indexOf('lobehub + boxd'));

    const rows = await inboxRows();
    expect(rows.every((row) => row.readAt !== null && row.topicId === 'tpc_mail_wake_1')).toBe(
      true,
    );

    const again = await flush(queue.scheduled[0].payload);
    expect(await again.json()).toMatchObject({ result: 'empty' });
    expect(runs).toHaveLength(1);
  });

  it('leaves out what the owner already read', async () => {
    const [first] = await inboxRows();
    await serverDB
      .update(agentInboxMessages)
      .set({ readAt: new Date() })
      .where(eq(agentInboxMessages.id, first.id));

    await flush(queue.scheduled[0].payload);

    expect(runs).toHaveLength(1);
    expect(runs[0].params.prompt).toContain('1 message arrived');
  });

  it('runs nothing once the owner switched wake off', async () => {
    await setWake({ mode: 'off' });

    const response = await flush(queue.scheduled[0].payload);

    expect(await response.json()).toMatchObject({ result: 'wake-off' });
    expect(runs).toHaveLength(0);
  });

  it('gives the messages back and books the next window when the run does not start', async () => {
    runFailure.next = 'budget exhausted';
    const booked = queue.scheduled.length;

    const failed = await flush(queue.scheduled[0].payload);

    // QStash retries this flush; should every retry fail, the next window tries again.
    expect(failed.status).toBe(500);
    expect(queue.scheduled).toHaveLength(booked + 1);
    const next = queue.scheduled.at(-1);
    // The default window is an hour; the next one starts where the held one ended.
    expect(next.payload.at).toBe(queue.scheduled[0].payload.at + 60 * 60_000);
    expect(next.deduplicationId).toBe(`agent-mail-digest:${accountId}:${next.payload.at}`);
    expect((await inboxRows()).every((row) => row.wakeClaimedAt === null)).toBe(true);

    const retried = await flush(next.payload);
    expect(await retried.json()).toMatchObject({ result: 'started' });
    expect(runs.at(-1)!.params.prompt).toContain('2 messages arrived');
  });

  it('never sweeps in mail that arrived while wake was off', async () => {
    await setWake({ mode: 'off' });
    await deliver('m_off_period', {
      from: 'pl@launchdriftcloud.com',
      messageId: '<off-period@launchdriftcloud.com>',
      subject: 'While you were off',
    });
    await setWake({ mode: 'on' });

    await flush(queue.scheduled[0].payload);

    expect(runs).toHaveLength(1);
    expect(runs[0].params.prompt).toContain('2 messages arrived');
    expect(runs[0].params.prompt).not.toContain('While you were off');
  });

  it('refuses a flush without a valid QStash signature', async () => {
    qstash.valid = false;

    const response = await flush(queue.scheduled[0].payload);

    expect(response.status).toBe(401);
    expect(runs).toHaveLength(0);
  });
});

describe('mail digest flush — a full batch', () => {
  it('runs one batch and books a prompt follow-up for the rest', async () => {
    const { DIGEST_BATCH_LIMIT } = await import('../wake/digest');
    await setWake({ mode: 'on' });
    for (let i = 0; i <= DIGEST_BATCH_LIMIT; i++) {
      await deliver(`m_bulk_${i}`, {
        from: `sender${i}@example.org`,
        messageId: `<bulk-${i}@example.org>`,
        subject: `Bulk ${i}`,
      });
    }
    const [window] = queue.scheduled;
    const booked = queue.scheduled.length;

    await flush(window.payload);

    expect(runs).toHaveLength(1);
    expect(runs[0].params.prompt).toContain(`${DIGEST_BATCH_LIMIT} messages arrived`);
    const followUp = queue.scheduled.at(-1);
    expect(queue.scheduled).toHaveLength(booked + 1);
    expect(followUp.delay).toBeLessThanOrEqual(60_000);

    await flush(followUp.payload);
    expect(runs).toHaveLength(2);
    expect(runs[1].params.prompt).toContain('1 message arrived');
  });

  it('fails the flush so QStash retries the leftover when the follow-up cannot be booked', async () => {
    const { DIGEST_BATCH_LIMIT } = await import('../wake/digest');
    await setWake({ mode: 'on' });
    for (let i = 0; i <= DIGEST_BATCH_LIMIT; i++) {
      await deliver(`m_stuck_${i}`, {
        from: `sender${i}@example.org`,
        messageId: `<stuck-${i}@example.org>`,
        subject: `Stuck ${i}`,
      });
    }
    const [window] = queue.scheduled;
    queue.failNext = 1;

    const failed = await flush(window.payload);

    // Acknowledging the flush here would leave the rest unread until someone writes again, so the
    // flush reports the failure instead; the batch it did run keeps its messages.
    expect(failed.status).toBe(500);
    expect(runs).toHaveLength(1);
    expect((await inboxRows()).filter((row) => row.readAt === null)).toHaveLength(1);

    const retried = await flush(window.payload);
    expect(retried.status).toBe(200);
    expect(runs).toHaveLength(2);
    expect(runs[1].params.prompt).toContain('1 message arrived');
  });
});
