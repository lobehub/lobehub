// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SignalModel } from '../signal';
import { SignalDecisionModel } from '../signalDecision';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'signal-decision-edges-user';
const agentId = 'signal-decision-edges-agent';
const scopeKey = 'discord:app-edges';

let seq = 0;

/**
 * Records one signal/decision pair for `scopeKey`. `metadata` is what the source
 * addressed the message to (kept after a purge); `payload` is the content itself.
 */
const record = async ({
  metadata = {},
  payload = {},
  outcome = 'wake',
  reason = 'explicit-mention',
}: {
  metadata?: Record<string, unknown>;
  outcome?: 'defer' | 'skip' | 'wake';
  payload?: Record<string, unknown>;
  reason?: string;
} = {}) => {
  seq += 1;
  const signal = (await new SignalModel(serverDB, userId).record({
    externalId: `edges-${seq}`,
    metadata,
    payload,
    scopeKey,
    source: 'bot:discord',
    type: 'bot.message.merged',
  }))!;

  const decision = (await new SignalDecisionModel(serverDB, userId).record({
    agentId,
    finalReason: reason,
    outcome,
    pipelineVersion: 'bot-wake@3',
    scopeKey,
    signalId: signal.id,
  }))!;

  return { decision, signal };
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users);
});

describe('SignalDecisionModel scope read edges', () => {
  it('reads a message that carried neither an address nor text', async () => {
    const { decision } = await record();

    const [item] = (await new SignalDecisionModel(serverDB, userId).listByScope({ scopeKey }))
      .items;

    expect(item).toMatchObject({
      address: null,
      // The payload held no `text` and the signal was never purged: nothing to preview.
      text: null,
      textPurged: false,
    });
    expect(item.id).toBe(decision.id);
  });

  it('counts no follow-up wakes when the scope declares no follow-up reasons', async () => {
    await record({ reason: 'watch-keyword' });
    await record({ outcome: 'skip', reason: 'not-addressed' });

    const summary = await new SignalDecisionModel(serverDB, userId).summaryByScope({
      followupReasons: [],
      labelSources: [],
      scopeKey,
      since: new Date(0),
    });

    expect(summary).toEqual({
      defer: 0,
      // A wake whose reason is on no follow-up list is an ordinary wake.
      followupWakes: 0,
      labels: {},
      skip: 1,
      total: 2,
      wake: 1,
    });
  });

  it('degrades to zeros when the aggregate comes back without a row', async () => {
    // `count(*)` always yields a row in Postgres, so a driver/result set that
    // carries none is a defensive case the DB itself cannot produce. Counts must
    // still read as 0 rather than undefined, and labels must not be queried.
    const where = vi.fn().mockResolvedValue([]);
    vi.spyOn(serverDB, 'select').mockReturnValueOnce({
      from: () => ({ where }),
    } as unknown as ReturnType<LobeChatDatabase['select']>);

    const summary = await new SignalDecisionModel(serverDB, userId).summaryByScope({
      followupReasons: ['watch-keyword'],
      labelSources: ['user'],
      scopeKey,
      since: new Date(0),
    });

    expect(summary).toEqual({
      defer: 0,
      followupWakes: 0,
      labels: {},
      skip: 0,
      total: 0,
      wake: 0,
    });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('treats a decision row without stored verdicts as no verdicts', async () => {
    // `verdicts` is `notNull().default([])`, so only a row read from an older
    // snapshot (or a driver that hands back null) can lack them; the read must
    // still return the documented empty array.
    const limit = vi.fn().mockResolvedValue([
      {
        address: null,
        createdAt: new Date(),
        createdAtIso: '2026-10-30T00:00:00.000000Z',
        finalReason: 'explicit-mention',
        id: '11111111-1111-4111-8111-111111111111',
        outcome: 'wake',
        purged: false,
        text: 'hi',
        toTag: null,
        verdicts: null,
      },
    ]);
    vi.spyOn(serverDB, 'select').mockReturnValueOnce({
      from: () => ({
        leftJoin: () => ({ where: () => ({ orderBy: () => ({ limit }) }) }),
      }),
    } as unknown as ReturnType<LobeChatDatabase['select']>);

    const { items } = await new SignalDecisionModel(serverDB, userId).listByScope({ scopeKey });

    expect(items).toEqual([
      {
        address: null,
        createdAt: expect.any(Date),
        finalReason: 'explicit-mention',
        id: '11111111-1111-4111-8111-111111111111',
        labels: [],
        outcome: 'wake',
        text: 'hi',
        textPurged: false,
        toTag: null,
        verdicts: [],
      },
    ]);
    expect(limit).toHaveBeenCalledWith(expect.any(Number));
  });
});
