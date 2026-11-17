// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import type { ExecAgentResult, GenericWebhookConfig } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import type { NewSignal } from '@/database/schemas';
import { agents, signalDecisions, signals, topics, users, workspaces } from '@/database/schemas';

import type { WebhookWakeDeps } from './waker';
import { MAX_RUNS_PER_WAKE, wakeInboundWebhook } from './waker';

const boundary = vi.hoisted(() => ({
  canUse: vi.fn(),
  enabled: vi.fn(),
  gateKeeper: {
    encrypt: async (value: string) => `cipher:${value}`,
    decrypt: async (value: string) => ({ plaintext: value.slice(7) }),
  },
}));
vi.mock('./featureGate', () => ({ isWebhookEnabled: boundary.enabled }));
vi.mock('@/server/services/resourcePermission', () => ({
  canPerformResourceAction: boundary.canUse,
  getResourceMeta: async () => ({
    userId: 'generic-wake-user',
    visibility: 'public',
    workspaceId: 'generic-wake-ws',
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => boundary.gateKeeper },
}));

const db = await getTestDB();
const userId = 'generic-wake-user';
const agentId = 'generic-wake-agent';
const model = new InboundWebhookModel(db, userId, undefined, boundary.gateKeeper);
const execute = vi.fn<NonNullable<WebhookWakeDeps['execute']>>();
const intervention = vi.fn<NonNullable<WebhookWakeDeps['intervention']>>();
const deps = { execute, intervention };
let runs = 0;
const started = (topicId: string): ExecAgentResult => ({
  agentId,
  assistantMessageId: `assistant-${runs}`,
  autoStarted: true,
  createdAt: '2026-11-13T08:00:00Z',
  message: 'started',
  operationId: `op-${runs}`,
  status: 'running',
  success: true,
  topicId,
});

let id: string;
const seedWebhook = async (config: Partial<GenericWebhookConfig> = {}, name = 'CI alerts') => {
  id = (
    await model.create({
      agentId,
      config: { autoApprove: false, topicMode: 'new', ...config },
      instructions: 'Triage the failure',
      kind: 'generic',
      name,
      secret: 'token',
      status: 'active',
      verification: { scheme: 'bearer_token' },
    })
  ).id;
};
let order = 0;
const seedSignal = async (threadKey?: string, patch: Partial<NewSignal> = {}) => {
  order++;
  const [row] = await db
    .insert(signals)
    .values({
      agentId,
      externalId: `${id}:call-${crypto.randomUUID()}`,
      metadata: { address: { webhookId: id, ...(threadKey ? { threadKey } : {}) } },
      occurredAt: new Date(Date.UTC(2026, 10, 13, 8, 0, order)),
      payload: { body: { n: order }, headers: {} },
      scopeKey: `inbound-webhook:${id}`,
      source: 'webhook',
      type: 'webhook',
      userId,
      ...patch,
    })
    .returning();
  return row;
};
const signalRows = () =>
  db
    .select()
    .from(signals)
    .where(eq(signals.scopeKey, `inbound-webhook:${id}`));

beforeEach(async () => {
  vi.clearAllMocks();
  runs = 0;
  order = 0;
  boundary.enabled.mockResolvedValue(true);
  boundary.canUse.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  intervention.mockResolvedValue({ allowList: ['safe-read'], approvalMode: 'manual' });
  execute.mockImplementation(async (params) => {
    runs++;
    const topicId = params.appContext?.topicId ?? `topic-${runs}`;
    if (!params.appContext?.topicId)
      await db.insert(topics).values({
        agentId,
        id: topicId,
        metadata: params.webhookThread ? { webhook: params.webhookThread } : undefined,
        userId,
      });
    return started(topicId);
  });
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
});
afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, 'generic-wake-ws'));
  await db.delete(users).where(eq(users.id, userId));
  vi.restoreAllMocks();
});

describe('generic webhook wakes', () => {
  it('runs the calls waiting without a thread together, once, in one new Topic', async () => {
    await seedWebhook();
    await seedSignal();
    await seedSignal();

    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'processed' });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].prompt.match(/<event /g)).toHaveLength(2);
    for (const [params] of execute.mock.calls) {
      expect(params).toMatchObject({
        agentId,
        autoStart: true,
        externalOrigin: {
          kind: 'generic',
          label: 'CI alerts',
          provider: 'webhook',
          resourceId: id,
        },
        markTopicRunning: true,
        title: 'CI alerts',
        trigger: RequestTrigger.Webhook,
      });
      expect(params.appContext).toBeUndefined();
      expect(params.webhookThread).toBeUndefined();
      expect(params.prompt).toContain('<webhookEvent');
      expect(params.prompt).toContain('<instruction>Triage the failure</instruction>');
    }
    expect((await signalRows()).map((s) => s.status)).toEqual(['processed', 'processed']);
    const decisions = await db.select().from(signalDecisions);
    expect(decisions.map((d) => d.topicId)).toEqual(['topic-1', 'topic-1']);
    expect(decisions.map((d) => d.operationId)).toEqual(['op-1', 'op-1']);

    // A later call starts a Topic of its own again.
    await seedSignal();
    await wakeInboundWebhook(db, id, deps);
    expect(execute.mock.calls[1][0].appContext).toBeUndefined();
  });

  it('runs a thread in one Topic: a new one first, the same one afterwards', async () => {
    await seedWebhook();
    await seedSignal('ticket-42');
    await seedSignal('ticket-42');
    await wakeInboundWebhook(db, id, deps);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({
      title: 'CI alerts · ticket-42',
      webhookThread: { threadKey: 'ticket-42', webhookId: id },
    });
    expect(execute.mock.calls[0][0].prompt.match(/<event /g)).toHaveLength(2);

    await seedSignal('ticket-42');
    await wakeInboundWebhook(db, id, deps);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].appContext).toEqual({ topicId: 'topic-1' });
    expect(execute.mock.calls[1][0].webhookThread).toBeUndefined();
  });

  it('runs other threads while one thread waits for its busy Topic', async () => {
    await seedWebhook();
    await seedSignal('ticket-a');
    await wakeInboundWebhook(db, id, deps);
    // Thread A's Topic is now busy (e.g. waiting for an approval); a call for B arrives after A's.
    execute.mockClear();
    execute.mockImplementation(async (params) => {
      if (params.appContext?.topicId === 'topic-1')
        return { error: new Error('TopicStartReservationError: occupied') } as never;
      runs++;
      await db.insert(topics).values({
        agentId,
        id: `topic-${runs}`,
        metadata: params.webhookThread ? { webhook: params.webhookThread } : undefined,
        userId,
      });
      return started(`topic-${runs}`);
    });
    const waitingA = await seedSignal('ticket-a');
    const callB = await seedSignal('ticket-b');

    // B ran; A still waits, so the next wake is asked for (it backs off if A is still busy).
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'more' });

    expect(
      execute.mock.calls.map(([params]) => params.webhookThread?.threadKey ?? 'continued'),
    ).toEqual(['continued', 'ticket-b']);
    const rows = await signalRows();
    expect(rows.find((s) => s.id === waitingA.id)).toMatchObject({
      error: 'topic_busy',
      status: 'pending',
    });
    expect(rows.find((s) => s.id === callB.id)?.status).toBe('processed');
  });

  it('carries at most 20 calls of a thread per run and runs the rest next', async () => {
    await seedWebhook();
    for (let i = 0; i < 21; i++) await seedSignal('ticket-42');
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'more' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'processed' });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0].prompt.match(/<event /g)).toHaveLength(20);
    expect(execute.mock.calls[0][0].prompt).not.toContain('<omitted');
    expect(execute.mock.calls[1][0].prompt.match(/<event /g)).toHaveLength(1);
    expect(execute.mock.calls[1][0].appContext).toEqual({ topicId: 'topic-1' });
    expect((await signalRows()).every((s) => s.status === 'processed')).toBe(true);
  });

  it('keeps the backoff when every group it tried was busy', async () => {
    await seedWebhook();
    for (let i = 0; i < 3; i++) await seedSignal(`ticket-${i}`);
    execute.mockResolvedValue({
      error: new Error('TopicStartReservationError: occupied'),
    } as never);
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'deferred' });
    // Each busy thread was tried once; none started a run.
    expect(execute).toHaveBeenCalledTimes(3);
    expect((await signalRows()).every((s) => s.status === 'pending')).toBe(true);
  });

  it('leaves a thread alone while another wake holds one of its calls', async () => {
    await seedWebhook();
    // Another wake has claimed ticket-1's first call and may still be creating its Topic.
    const held = { inboundWebhookWake: { leaseUntil: Date.now() + 60_000, token: 'other' } };
    await seedSignal('ticket-1', {
      metadata: { address: { threadKey: 'ticket-1', webhookId: id }, extra: held },
    });
    const later = await seedSignal('ticket-1');
    const other = await seedSignal('ticket-2');

    await wakeInboundWebhook(db, id, deps);

    expect(execute.mock.calls.map(([params]) => params.webhookThread?.threadKey)).toEqual([
      'ticket-2',
    ]);
    const rows = await signalRows();
    expect(rows.find((s) => s.id === later.id)?.status).toBe('pending');
    expect(rows.find((s) => s.id === other.id)?.status).toBe('processed');
  });

  it('continues the topic its creator picked, and its own once that one is gone', async () => {
    await db.insert(topics).values({ agentId, id: 'picked', userId });
    await seedWebhook({ topicId: 'picked', topicMode: 'reuse' });
    await seedSignal();
    await wakeInboundWebhook(db, id, deps);
    expect(execute.mock.calls[0][0].appContext).toEqual({ topicId: 'picked' });
    expect(execute.mock.calls[0][0].webhookThread).toBeUndefined();

    await db.delete(topics).where(eq(topics.id, 'picked'));
    await seedSignal();
    await wakeInboundWebhook(db, id, deps);
    expect(execute.mock.calls[1][0].webhookThread).toEqual({ threadKey: '', webhookId: id });
  });

  it('puts every call of a reuse webhook in one shared Topic', async () => {
    await seedWebhook({ topicMode: 'reuse' });
    await seedSignal();
    await wakeInboundWebhook(db, id, deps);
    expect(execute.mock.calls[0][0].webhookThread).toEqual({ threadKey: '', webhookId: id });

    await seedSignal();
    await wakeInboundWebhook(db, id, deps);
    expect(execute.mock.calls[1][0].appContext).toEqual({ topicId: 'topic-1' });
  });

  it("keeps the user's approval settings, and auto-approve never becomes headless", async () => {
    await seedWebhook();
    await seedSignal();
    await wakeInboundWebhook(db, id, deps);
    expect(execute.mock.calls[0][0].userInterventionConfig).toEqual({
      allowList: ['safe-read'],
      approvalMode: 'manual',
    });

    await model.update(id, { config: { autoApprove: true, topicMode: 'new' } });
    await seedSignal();
    await wakeInboundWebhook(db, id, deps);
    expect(execute.mock.calls[1][0].userInterventionConfig).toEqual({
      allowList: ['safe-read'],
      approvalMode: 'auto-run',
    });
    for (const [params] of execute.mock.calls)
      expect(params.userInterventionConfig?.approvalMode).not.toBe('headless');
  });

  it('records calls but wakes nothing while the feature is off for the owner', async () => {
    await seedWebhook();
    await seedSignal();
    boundary.enabled.mockResolvedValue(false);
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'ignored' });
    expect(execute).not.toHaveBeenCalled();
    expect(await signalRows()).toMatchObject([{ error: 'feature_disabled', status: 'ignored' }]);
  });

  it('settles what was waiting when the webhook is paused, instead of running it', async () => {
    await seedWebhook();
    await seedSignal();
    await model.update(id, { status: 'paused' });
    await wakeInboundWebhook(db, id, deps);
    expect(execute).not.toHaveBeenCalled();
    expect(await signalRows()).toMatchObject([{ error: 'webhook_paused', status: 'ignored' }]);
  });

  it('starts one run per wake and asks to be woken again for the next thread', async () => {
    expect(MAX_RUNS_PER_WAKE).toBe(1);
    await seedWebhook();
    await seedSignal('ticket-a');
    await seedSignal('ticket-b');
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'more' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await signalRows()).filter((s) => s.status === 'pending')).toHaveLength(1);
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'processed' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('stops at 30 runs in 10 minutes and records why', async () => {
    await seedWebhook();
    await seedSignal();
    await db.update(signals).set({ status: 'pending' });
    for (let i = 0; i < 30; i++) expect(await model.reserveWake(id)).toBeDefined();
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'capped' });
    expect(execute).not.toHaveBeenCalled();
    expect((await model.findById(id))?.lastError).toBe('wake_cap');
  });

  it('runs nothing as an owner who may no longer use the workspace agent', async () => {
    await db.insert(workspaces).values({
      id: 'generic-wake-ws',
      name: 'Team',
      primaryOwnerId: userId,
      slug: 'generic-wake-ws',
    });
    await db.insert(agents).values({ id: `${agentId}-ws`, userId, workspaceId: 'generic-wake-ws' });
    const teamModel = new InboundWebhookModel(db, userId, 'generic-wake-ws', boundary.gateKeeper);
    id = (
      await teamModel.create({
        agentId: `${agentId}-ws`,
        config: { autoApprove: true, topicMode: 'new' },
        kind: 'generic',
        name: 'Team hook',
        secret: 'token',
        status: 'active',
        verification: { scheme: 'bearer_token' },
      })
    ).id;
    await seedSignal(undefined, { agentId: `${agentId}-ws` });
    // e.g. removed from the workspace, or the agent's access level lowered.
    boundary.canUse.mockResolvedValue(false);

    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'ignored' });
    expect(execute).not.toHaveBeenCalled();
    expect(boundary.canUse).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'use', resourceId: `${agentId}-ws`, userId }),
    );
    expect(await signalRows()).toMatchObject([
      { error: 'owner_access_revoked', status: 'ignored' },
    ]);
    expect(await teamModel.findById(id)).toBeDefined();
  });

  it('removes the webhook once its agent is gone', async () => {
    await seedWebhook();
    await seedSignal();
    await db.delete(agents).where(eq(agents.id, agentId));
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'gone' });
    expect(await model.findById(id)).toBeUndefined();
  });
});
