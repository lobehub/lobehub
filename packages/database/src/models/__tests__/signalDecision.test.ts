// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, signalDecisionLabels, signalDecisions, signals, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SignalModel } from '../signal';
import { SignalDecisionModel } from '../signalDecision';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'signal-decision-user';
const otherUserId = 'signal-decision-other-user';
const agentId = 'signal-decision-agent';

const signalInput = (externalId = 'msg-1') => ({
  externalId,
  payload: { text: 'hi' },
  scopeKey: 'discord:app-1:thread-1',
  source: 'bot:discord',
  type: 'bot.message.merged',
});

const decisionInput = (signalId: string, overrides = {}) => ({
  agentId,
  finalReason: 'explicit-mention',
  outcome: 'wake' as const,
  pipelineVersion: 'bot-wake@1',
  scopeKey: 'discord:app-1:thread-1',
  signalId,
  toTag: 'mention',
  verdicts: [
    {
      confidence: 1,
      latencyMs: 0,
      mode: 'shadow' as const,
      policyId: 'legacy-router',
      reason: 'explicit-mention',
      verdict: 'allow' as const,
      version: 1,
    },
  ],
  ...overrides,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('SignalModel', () => {
  it('stores a signal once per (source, external_id) and returns the stored row on redelivery', async () => {
    const model = new SignalModel(serverDB, userId);

    const first = await model.record(signalInput());
    const again = await model.record(signalInput());

    expect(again?.id).toBe(first?.id);
    expect(await serverDB.select().from(signals)).toHaveLength(1);
    expect(first).toMatchObject({ scopeKey: 'discord:app-1:thread-1', userId });
  });

  it('defaults signal metadata to an empty object and keeps how the event arrived', async () => {
    const model = new SignalModel(serverDB, userId);

    expect((await model.record(signalInput('bare')))?.metadata).toEqual({});

    const metadata = {
      address: { platform: 'discord', platformThreadId: 'thread-1' },
      entryPoint: 'catchAll',
    };
    const stored = await model.record({ ...signalInput('addressed'), metadata });
    expect(stored?.metadata).toEqual(metadata);
    // A redelivery returns the first row; it does not overwrite what was recorded.
    const again = await model.record({ ...signalInput('addressed'), metadata: { entryPoint: 'x' } });
    expect(again?.metadata).toEqual(metadata);
  });

  it('does not hand back another user’s row for a colliding key', async () => {
    await new SignalModel(serverDB, otherUserId).record(signalInput());

    expect(await new SignalModel(serverDB, userId).record(signalInput())).toBeUndefined();
  });
});

describe('SignalDecisionModel', () => {
  const recordSignal = async (externalId?: string) =>
    (await new SignalModel(serverDB, userId).record(signalInput(externalId)))!;

  it('records a decision with its verdicts and tracing ids', async () => {
    const signal = await recordSignal();
    const model = new SignalDecisionModel(serverDB, userId);

    const decision = await model.record(
      decisionInput(signal.id, { llmTracingIds: ['11111111-1111-1111-1111-111111111111'] }),
    );

    expect(decision).toMatchObject({
      finalReason: 'explicit-mention',
      llmTracingIds: ['11111111-1111-1111-1111-111111111111'],
      outcome: 'wake',
      pipelineVersion: 'bot-wake@1',
      toTag: 'mention',
      userId,
    });
    expect(decision?.verdicts).toEqual([
      expect.objectContaining({
        latencyMs: 0,
        mode: 'shadow',
        policyId: 'legacy-router',
        version: 1,
      }),
    ]);
  });

  it('defaults decision metadata to an empty object and keeps what the pipeline stores', async () => {
    const model = new SignalDecisionModel(serverDB, userId);

    const bare = await model.record(decisionInput((await recordSignal('msg-bare')).id));
    expect(bare?.metadata).toEqual({});

    const metadata = {
      configRevision: 'cfg-7',
      mergedSourceIds: ['msg-a', 'msg-b'],
      stateSnapshot: { followupBudget: 2, ownerLastSpokeAt: 1_700_000_000_000 },
    };
    const withState = await model.record(
      decisionInput((await recordSignal('msg-state')).id, { metadata }),
    );
    expect(withState?.metadata).toEqual(metadata);
    expect((await model.findById(withState!.id))?.metadata).toEqual(metadata);
  });

  it('is idempotent per (signal, agent, pipeline version) but keeps a new pipeline version apart', async () => {
    const signal = await recordSignal();
    const model = new SignalDecisionModel(serverDB, userId);

    const first = await model.record(decisionInput(signal.id));
    const again = await model.record(decisionInput(signal.id, { outcome: 'skip' }));
    const v2 = await model.record(decisionInput(signal.id, { pipelineVersion: 'bot-wake@2' }));

    expect(again?.id).toBe(first?.id);
    expect(again?.outcome).toBe('wake');
    expect(v2?.id).not.toBe(first?.id);
    expect(await model.listBySignal(signal.id)).toHaveLength(2);
  });

  it('returns each agent’s own decision when the same signal is redelivered', async () => {
    const otherAgentId = 'signal-decision-agent-2';
    await serverDB.insert(agents).values({ id: otherAgentId, userId });
    const signal = await recordSignal();
    const model = new SignalDecisionModel(serverDB, userId);

    const first = await model.record(decisionInput(signal.id));
    const second = await model.record(decisionInput(signal.id, { agentId: otherAgentId }));
    const secondAgain = await model.record(decisionInput(signal.id, { agentId: otherAgentId }));
    const firstAgain = await model.record(decisionInput(signal.id));

    expect(second?.id).not.toBe(first?.id);
    expect(secondAgain?.id).toBe(second?.id);
    expect(secondAgain?.agentId).toBe(otherAgentId);
    expect(firstAgain?.id).toBe(first?.id);
    expect(await model.listBySignal(signal.id)).toHaveLength(2);
  });

  it('keeps the decisions when two agents that decided the same signal are deleted', async () => {
    const otherAgentId = 'signal-decision-agent-2';
    await serverDB.insert(agents).values({ id: otherAgentId, userId });
    const signal = await recordSignal();
    const model = new SignalDecisionModel(serverDB, userId);
    await model.record(decisionInput(signal.id));
    await model.record(decisionInput(signal.id, { agentId: otherAgentId }));

    // Both rows end up with a NULL agent. The unique index must not make that collide, or the
    // second delete would fail on the ON DELETE SET NULL update.
    await serverDB.delete(agents).where(inArray(agents.id, [agentId, otherAgentId]));

    const rows = await model.listBySignal(signal.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.agentId === null)).toBe(true);
  });

  it('refuses a decision without an agent, since the idempotency key needs one', async () => {
    const signal = await recordSignal();
    const model = new SignalDecisionModel(serverDB, userId);

    // @ts-expect-error `agentId` is required
    await expect(model.record({ ...decisionInput(signal.id), agentId: undefined })).rejects.toThrow(
      /needs the agent/,
    );
    expect(await model.listBySignal(signal.id)).toHaveLength(0);
  });

  it('refuses to attach a decision to another user’s signal', async () => {
    const signal = await recordSignal();

    expect(
      await new SignalDecisionModel(serverDB, otherUserId).record(decisionInput(signal.id)),
    ).toBeUndefined();
    expect(await serverDB.select().from(signalDecisions)).toHaveLength(0);
  });

  it('links the run a decision started', async () => {
    const signal = await recordSignal();
    const model = new SignalDecisionModel(serverDB, userId);
    const decision = (await model.record(decisionInput(signal.id)))!;

    const linked = await model.linkRun(decision.id, { operationId: 'op-1' });

    expect(linked).toMatchObject({ operationId: 'op-1', topicId: null });
  });

  describe('labels', () => {
    it('appends labels and never rewrites earlier ones', async () => {
      const signal = await recordSignal();
      const model = new SignalDecisionModel(serverDB, userId);
      const decision = (await model.record(decisionInput(signal.id)))!;

      await model.addLabel(decision.id, { label: 'false_wake', source: 'user', actor: userId });
      await model.addLabel(decision.id, {
        confidence: 0.9,
        label: 'correct',
        source: 'llm_judge',
        actor: 'judge-model',
      });
      await model.addLabel(decision.id, { label: 'correct', source: 'user', actor: userId });

      const labels = await model.listLabels(decision.id);
      expect(labels.map((l) => [l.source, l.label])).toHaveLength(3);
      expect(labels.map((l) => l.label).sort()).toEqual(['correct', 'correct', 'false_wake']);
      expect(labels.find((l) => l.source === 'llm_judge')).toMatchObject({
        actor: 'judge-model',
        confidence: 0.9,
      });
    });

    it('defaults label metadata to an empty object and keeps reason and evidence', async () => {
      const signal = await recordSignal();
      const model = new SignalDecisionModel(serverDB, userId);
      const decision = (await model.record(decisionInput(signal.id)))!;

      await model.addLabel(decision.id, { label: 'false_wake', source: 'user' });
      await model.addLabel(decision.id, {
        label: 'missed_wake',
        metadata: { evidenceExternalId: 'msg-later', reason: 'manual_mention', surface: 'job' },
        source: 'heuristic',
      });

      const labels = await model.listLabels(decision.id);
      expect(labels.find((l) => l.source === 'user')?.metadata).toEqual({});
      expect(labels.find((l) => l.source === 'heuristic')?.metadata).toEqual({
        evidenceExternalId: 'msg-later',
        reason: 'manual_mention',
        surface: 'job',
      });
    });

    it('does not label or list another user’s decision', async () => {
      const signal = await recordSignal();
      const decision = (await new SignalDecisionModel(serverDB, userId).record(
        decisionInput(signal.id),
      ))!;
      const intruder = new SignalDecisionModel(serverDB, otherUserId);

      expect(await intruder.addLabel(decision.id, { label: 'correct', source: 'user' })).toBe(
        undefined,
      );
      expect(await intruder.listLabels(decision.id)).toEqual([]);
      expect(await serverDB.select().from(signalDecisionLabels)).toHaveLength(0);
    });

    it('goes away with its decision', async () => {
      const signal = await recordSignal();
      const model = new SignalDecisionModel(serverDB, userId);
      const decision = (await model.record(decisionInput(signal.id)))!;
      await model.addLabel(decision.id, { label: 'correct', source: 'user' });

      await serverDB.delete(signalDecisions).where(eq(signalDecisions.id, decision.id));

      expect(await serverDB.select().from(signalDecisionLabels)).toHaveLength(0);
    });
  });
});
