// @vitest-environment node
import { agents, signalDecisions, signals, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pruneSignals } from '../pruneSignals';

const db = await getTestDB();
vi.mock('@/database/server', () => ({ getServerDB: async () => db }));

const userId = 'prune-signals-user';
const agentId = 'prune-signals-agent';

const app = new Hono().post('/prune-signals', pruneSignals);
const post = (body?: unknown) =>
  app.request('/prune-signals', {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

const seed = async (externalId: string, ageMinutes: number) => {
  const [row] = await db
    .insert(signals)
    .values({
      createdAt: new Date(Date.now() - ageMinutes * 60_000),
      externalId,
      payload: { text: externalId },
      scopeKey: 'telegram:app-1',
      source: 'bot:telegram',
      type: 'bot.message.merged',
      userId,
    })
    .returning();
  return row;
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  await db.delete(users);
});

describe('POST /prune-signals', () => {
  it('prunes to the configured quota, keeps decided signals and blanks old payloads', async () => {
    const decided = await seed('decided', 60 * 24 * 30);
    await db.insert(signalDecisions).values({
      agentId,
      outcome: 'wake',
      pipelineVersion: 'bot-wake@1',
      scopeKey: 'telegram:app-1',
      signalId: decided.id,
      userId,
    });
    for (let i = 1; i <= 5; i++) await seed(`m${i}`, i);

    const response = await post({ keepPerSource: 2, payloadTtlHours: 24 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      buckets: 1,
      deleted: 3,
      purgedPayloads: 1,
      success: true,
    });
    const rows = await db.select().from(signals);
    expect(rows.map((r) => r.externalId).sort()).toEqual(['decided', 'm1', 'm2']);
    expect(rows.find((r) => r.externalId === 'decided')).toMatchObject({ payload: {} });
    expect(rows.find((r) => r.externalId === 'm1')?.payload).toEqual({ text: 'm1' });
  });

  it('runs with defaults when QStash sends no body', async () => {
    await seed('m1', 1);

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      buckets: 0,
      deleted: 0,
      purgedPayloads: 0,
      success: true,
    });
  });
});
