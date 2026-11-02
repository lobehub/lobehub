// @vitest-environment node
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { agents, signalDecisions, signals, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordSignalDecision } from '../recordDecision';

const db = await getTestDB();
const userId = 'record-decision-user';
const agentId = 'record-decision-agent';

const params = (overrides: Record<string, unknown> = {}) => ({
  agentId,
  decision: {
    finalReason: 'explicit-mention',
    outcome: 'wake' as const,
    pipelineVersion: 'bot-wake@1',
    toTag: 'mention',
  },
  scopeKey: 'discord:app-1',
  signal: {
    externalId: 'app-1:thread-1:msg-1',
    payload: { message: 'hello' },
    source: 'bot:discord',
    sourceType: AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
    type: AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
  },
  userId,
  ...overrides,
});

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  await db.delete(users);
});

describe('recordSignalDecision', () => {
  it('stores the signal and its decision for an on_decision source', async () => {
    const result = await recordSignalDecision(db, params());

    expect(result.persisted).toBe(true);
    const [signal] = await db.select().from(signals);
    const [decision] = await db.select().from(signalDecisions);
    expect(signal).toMatchObject({ scopeKey: 'discord:app-1', source: 'bot:discord', userId });
    expect(decision).toMatchObject({
      agentId,
      outcome: 'wake',
      scopeKey: 'discord:app-1',
      signalId: signal.id,
      toTag: 'mention',
    });
  });

  it('keeps the context the decision was made in', async () => {
    const stateSnapshot = { channel: { silentWakes: 2 }, explicitMention: false };
    await recordSignalDecision(
      db,
      params({
        decision: {
          finalReason: 'watch-keyword',
          metadata: { stateSnapshot },
          outcome: 'wake',
          pipelineVersion: 'bot-wake@1',
          toTag: 'keyword',
        },
      }),
    );

    const [decision] = await db.select().from(signalDecisions);
    expect(decision.metadata).toEqual({ stateSnapshot });
  });

  it('keeps how the signal arrived apart from the payload', async () => {
    const metadata = {
      address: { platform: 'discord', platformThreadId: 'thread-1' },
      entryPoint: 'catchAll',
    };
    await recordSignalDecision(
      db,
      params({
        signal: {
          externalId: 'app-1:thread-1:msg-2',
          metadata,
          payload: { text: 'hello' },
          source: 'bot:discord',
          sourceType: AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
          type: AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
        },
      }),
    );

    const [signal] = await db.select().from(signals);
    expect(signal).toMatchObject({ metadata, payload: { text: 'hello' } });
  });

  it('writes nothing for a never source, even though a decision exists', async () => {
    const result = await recordSignalDecision(
      db,
      params({
        signal: {
          externalId: 'step-1',
          source: 'agent-signal',
          sourceType: AGENT_SIGNAL_SOURCE_TYPES.runtimeBeforeStep,
          type: AGENT_SIGNAL_SOURCE_TYPES.runtimeBeforeStep,
        },
      }),
    );

    expect(result).toEqual({ persisted: false });
    expect(await db.select().from(signals)).toHaveLength(0);
    expect(await db.select().from(signalDecisions)).toHaveLength(0);
  });

  it('is idempotent when the same message is redelivered', async () => {
    const first = await recordSignalDecision(db, params());
    const again = await recordSignalDecision(db, params());

    expect(again).toEqual(first);
    expect(await db.select().from(signals)).toHaveLength(1);
    expect(await db.select().from(signalDecisions)).toHaveLength(1);
  });
});
