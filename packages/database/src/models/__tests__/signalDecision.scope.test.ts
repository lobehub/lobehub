// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, signalDecisionLabels, signalDecisions, signals, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SignalModel } from '../signal';
import { SignalDecisionModel } from '../signalDecision';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'signal-decision-scope-user';
const otherUserId = 'signal-decision-scope-other';
const agentId = 'signal-decision-scope-agent';
const scopeKey = 'discord:app-1';

const FOLLOWUPS = ['watch-keyword', 'in-duty'];
const SOURCES = ['user', 'agent:no_reply'];

/** `minutesAgo` keeps the order explicit; rows recorded in one test otherwise share a clock. */
const seed = async (
  externalId: string,
  {
    minutesAgo = 0,
    outcome = 'wake' as const,
    reason = 'explicit-mention',
    scope = scopeKey,
    text = `text of ${externalId}`,
    owner = userId,
  }: {
    minutesAgo?: number;
    outcome?: 'defer' | 'skip' | 'wake';
    owner?: string;
    reason?: string;
    scope?: string;
    text?: string;
  } = {},
) => {
  const signal = (await new SignalModel(serverDB, owner).record({
    externalId,
    metadata: { address: { messageId: externalId, platform: 'discord' } },
    payload: { text },
    scopeKey: scope,
    source: 'bot:discord',
    type: 'bot.message.merged',
  }))!;
  const decision = (await new SignalDecisionModel(serverDB, owner).record({
    agentId,
    finalReason: reason,
    outcome,
    pipelineVersion: 'bot-wake@3',
    scopeKey: scope,
    signalId: signal.id,
  }))!;
  await serverDB
    .update(signalDecisions)
    .set({ createdAt: new Date(Date.now() - minutesAgo * 60_000) })
    .where(eq(signalDecisions.id, decision.id));

  return { decision, signal };
};

const label = (decisionId: string, source: string, value: any, minutesAgo: number) =>
  serverDB.insert(signalDecisionLabels).values({
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
    decisionId,
    label: value,
    source,
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: `${agentId}-other`, userId: otherUserId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('SignalDecisionModel scope reads', () => {
  describe('listByScope', () => {
    it('lists one channel newest first and pages by cursor without gaps or repeats', async () => {
      for (let i = 0; i < 5; i++) await seed(`m${i}`, { minutesAgo: 10 - i });
      // Another channel, and the same channel of another user, never show up.
      await seed('elsewhere', { scope: 'discord:app-2' });
      const model = new SignalDecisionModel(serverDB, userId);

      const first = await model.listByScope({ limit: 2, scopeKey });
      expect(first.items.map((i) => i.text)).toEqual(['text of m4', 'text of m3']);
      expect(first.nextCursor).toBeDefined();

      const second = await model.listByScope({ cursor: first.nextCursor, limit: 2, scopeKey });
      const third = await model.listByScope({ cursor: second.nextCursor, limit: 2, scopeKey });

      expect(second.items.map((i) => i.text)).toEqual(['text of m2', 'text of m1']);
      expect(third.items.map((i) => i.text)).toEqual(['text of m0']);
      expect(third.nextCursor).toBeUndefined();
    });

    it('keeps rows that share a millisecond apart through the cursor', async () => {
      const a = await seed('same-a');
      const b = await seed('same-b');
      const at = new Date();
      // Same instant: only the id tie-break orders them.
      await serverDB.update(signalDecisions).set({ createdAt: at });
      const model = new SignalDecisionModel(serverDB, userId);

      const first = await model.listByScope({ limit: 1, scopeKey });
      const second = await model.listByScope({ cursor: first.nextCursor, limit: 1, scopeKey });

      expect(new Set([...first.items, ...second.items].map((i) => i.id))).toEqual(
        new Set([a.decision.id, b.decision.id]),
      );
    });

    it('does not read another user’s decisions on the same channel', async () => {
      await seed('theirs', { owner: otherUserId });

      const page = await new SignalDecisionModel(serverDB, userId).listByScope({ scopeKey });

      expect(page.items).toEqual([]);
    });

    it('leaves out decisions older than the window', async () => {
      await seed('old', { minutesAgo: 60 * 24 * 31 });
      await seed('recent', { minutesAgo: 5 });

      const page = await new SignalDecisionModel(serverDB, userId).listByScope({ scopeKey });

      expect(page.items.map((i) => i.text)).toEqual(['text of recent']);
    });

    it('filters by outcome, reason and whether a source has labelled it', async () => {
      const woke = await seed('woke', { minutesAgo: 3, reason: 'watch-keyword' });
      const skipped = await seed('skipped', {
        minutesAgo: 2,
        outcome: 'skip',
        reason: 'not-addressed',
      });
      await seed('mention', { minutesAgo: 1 });
      await label(woke.decision.id, 'agent:no_reply', 'false_wake', 1);
      await label(skipped.decision.id, 'user', 'missed_wake', 1);
      const model = new SignalDecisionModel(serverDB, userId);

      const ids = async (params: Parameters<typeof model.listByScope>[0]) =>
        (await model.listByScope(params)).items.map((i) => i.id);

      expect(await ids({ outcome: 'skip', scopeKey })).toEqual([skipped.decision.id]);
      expect(await ids({ finalReasons: FOLLOWUPS, scopeKey })).toEqual([woke.decision.id]);
      expect(await ids({ labeled: { by: 'user', has: true }, scopeKey })).toEqual([
        skipped.decision.id,
      ]);
      // The agent's own label does not count as the user's mark.
      expect(await ids({ labeled: { by: 'user', has: false }, scopeKey })).toHaveLength(2);
    });

    it('attaches the latest label of each source', async () => {
      const { decision } = await seed('labelled');
      await label(decision.id, 'user', 'false_wake', 5);
      await label(decision.id, 'user', 'correct', 1);
      await label(decision.id, 'agent:no_reply', 'dup_wake', 3);

      const [item] = (await new SignalDecisionModel(serverDB, userId).listByScope({ scopeKey }))
        .items;

      expect(
        item.labels.map((l) => [l.source, l.label]).sort(([a], [b]) => a.localeCompare(b)),
      ).toEqual([
        ['agent:no_reply', 'dup_wake'],
        ['user', 'correct'],
      ]);
    });

    it('treats a mark taken back (`cleared`) as no mark', async () => {
      const cleared = await seed('cleared', { minutesAgo: 3 });
      const remarked = await seed('remarked', { minutesAgo: 2 });
      await label(cleared.decision.id, 'user', 'false_wake', 5);
      await label(cleared.decision.id, 'user', 'cleared', 1);
      await label(remarked.decision.id, 'user', 'cleared', 5);
      await label(remarked.decision.id, 'user', 'correct', 1);
      const model = new SignalDecisionModel(serverDB, userId);

      const items = (await model.listByScope({ scopeKey })).items;
      const byId = new Map(items.map((i) => [i.id, i]));
      expect(byId.get(cleared.decision.id)?.labels).toEqual([]);
      expect(byId.get(remarked.decision.id)?.labels.map((l) => l.label)).toEqual(['correct']);

      const ids = async (has: boolean) =>
        (await model.listByScope({ labeled: { by: 'user', has }, scopeKey })).items.map(
          (i) => i.id,
        );
      expect(await ids(true)).toEqual([remarked.decision.id]);
      expect(await ids(false)).toEqual([cleared.decision.id]);

      const summary = await model.summaryByScope({
        followupReasons: FOLLOWUPS,
        labelSources: SOURCES,
        scopeKey,
        since: new Date(Date.now() - 24 * 60 * 60_000),
      });
      expect(summary.labels).toEqual({ user: { correct: 1 } });
    });

    it('cuts the preview and hides purged text while keeping the address', async () => {
      const long = await seed('long', { minutesAgo: 2, text: 'x'.repeat(500) });
      const purged = await seed('purged', { minutesAgo: 1 });
      await serverDB
        .update(signals)
        .set({ payload: {}, payloadPurgedAt: new Date() })
        .where(eq(signals.id, purged.signal.id));

      const items = (await new SignalDecisionModel(serverDB, userId).listByScope({ scopeKey }))
        .items;
      const byId = new Map(items.map((i) => [i.id, i]));

      expect(byId.get(long.decision.id)).toMatchObject({ textPurged: false });
      expect(byId.get(long.decision.id)?.text).toHaveLength(200);
      expect(byId.get(purged.decision.id)).toMatchObject({
        address: { messageId: 'purged', platform: 'discord' },
        text: null,
        textPurged: true,
      });
    });
  });

  describe('summaryByScope', () => {
    it('counts outcomes, follow-up wakes and current labels per source', async () => {
      const keyword = await seed('keyword', { reason: 'watch-keyword' });
      const mention = await seed('mention');
      const skipped = await seed('skip', { outcome: 'skip', reason: 'not-addressed' });
      await seed('defer', { outcome: 'defer', reason: 'in-duty' });
      await seed('old', { minutesAgo: 60 * 24 * 40 });
      await seed('theirs', { owner: otherUserId });

      await label(keyword.decision.id, 'agent:no_reply', 'false_wake', 2);
      // Only the latest user label counts.
      await label(mention.decision.id, 'user', 'false_wake', 3);
      await label(mention.decision.id, 'user', 'correct', 1);
      await label(skipped.decision.id, 'user', 'missed_wake', 1);
      await label(skipped.decision.id, 'llm_judge', 'correct', 1);

      const summary = await new SignalDecisionModel(serverDB, userId).summaryByScope({
        followupReasons: FOLLOWUPS,
        labelSources: SOURCES,
        scopeKey,
        since: new Date(Date.now() - 30 * 24 * 60 * 60_000),
      });

      expect(summary).toEqual({
        defer: 1,
        followupWakes: 1,
        labels: {
          'agent:no_reply': { false_wake: 1 },
          'user': { correct: 1, missed_wake: 1 },
        },
        skip: 1,
        total: 4,
        wake: 2,
      });
    });

    it('returns zeros for a channel with no decisions', async () => {
      const summary = await new SignalDecisionModel(serverDB, userId).summaryByScope({
        followupReasons: FOLLOWUPS,
        labelSources: SOURCES,
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
    });
  });
});
