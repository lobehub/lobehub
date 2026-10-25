// @vitest-environment node
import {
  agents,
  signalDecisionLabels,
  signalDecisions,
  signals,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { recordSignalDecision } from '@/server/services/agentSignal/persistence/recordDecision';

import { BOT_WAKE_PIPELINE_VERSION } from './BotMessageRouter/wakeDecision';
import { NO_REPLY_LABEL_SOURCE, recordNoReplyLabel } from './noReplyLabel';

const db = await getTestDB();
const userId = 'no-reply-user';
const agentId = 'no-reply-agent';
const applicationId = 'app-1';
const platformThreadId = 'discord:guild:channel:thread';

const recordWake = (messageId: string, pipelineVersion = BOT_WAKE_PIPELINE_VERSION) =>
  recordSignalDecision(db, {
    agentId,
    decision: { finalReason: 'watch-keyword', outcome: 'wake', pipelineVersion },
    scopeKey: `discord:${applicationId}`,
    signal: {
      externalId: `${applicationId}:${platformThreadId}:${messageId}`,
      source: 'bot:discord',
      sourceType: 'bot.message.merged',
      type: 'bot.message.merged',
    },
    userId,
  });

const labels = () =>
  db
    .select({
      actor: signalDecisionLabels.actor,
      decisionId: signalDecisionLabels.decisionId,
      label: signalDecisionLabels.label,
      metadata: signalDecisionLabels.metadata,
      source: signalDecisionLabels.source,
    })
    .from(signalDecisionLabels);

const params = (messageId: string, reason: 'duplicate' | 'off_topic' | 'empty_completion') => ({
  applicationId,
  noReply: { reason },
  operationId: 'op-1',
  platform: 'discord',
  platformThreadId,
  userId,
  userMessageId: messageId,
});

describe('recordNoReplyLabel (real database)', () => {
  beforeEach(async () => {
    await db.delete(users);
    await db.insert(users).values({ id: userId });
    await db.insert(agents).values({ id: agentId, userId });
  });

  it('writes false_wake on the wake decision, with the reason in the label metadata', async () => {
    const wake = await recordWake('m-1');
    if (!wake.persisted) throw new Error('wake decision was not persisted');

    expect(await recordNoReplyLabel(db, params('m-1', 'off_topic'))).toBe('false_wake');

    expect(await labels()).toEqual([
      {
        actor: 'op-1',
        decisionId: wake.decisionId,
        label: 'false_wake',
        metadata: { reason: 'off_topic', surface: 'agent' },
        source: NO_REPLY_LABEL_SOURCE,
      },
    ]);
  });

  it('writes dup_wake when the message had already been answered', async () => {
    await recordWake('m-2');

    expect(await recordNoReplyLabel(db, params('m-2', 'duplicate'))).toBe('dup_wake');

    expect((await labels()).map((l) => [l.label, l.source, l.metadata])).toEqual([
      ['dup_wake', NO_REPLY_LABEL_SOURCE, { reason: 'duplicate', surface: 'agent' }],
    ]);
  });

  it('labels only the decision of the message that woke the run', async () => {
    const first = await recordWake('m-3');
    const second = await recordWake('m-4');
    if (!first.persisted || !second.persisted) throw new Error('not persisted');

    await recordNoReplyLabel(db, params('m-4', 'empty_completion'));

    expect((await labels()).map((l) => l.decisionId)).toEqual([second.decisionId]);
    expect(
      await db.select().from(signalDecisions).where(eq(signalDecisions.id, first.decisionId)),
    ).toHaveLength(1);
  });

  it('ignores a decision from another pipeline version', async () => {
    await recordWake('m-5', 'bot-wake@0');

    expect(await recordNoReplyLabel(db, params('m-5', 'off_topic'))).toBeUndefined();
    expect(await labels()).toEqual([]);
  });

  it('returns undefined instead of throwing when the wake was never recorded', async () => {
    expect(await recordNoReplyLabel(db, params('never-seen', 'off_topic'))).toBeUndefined();
    expect(await db.select().from(signals)).toEqual([]);
    expect(await labels()).toEqual([]);
  });
});
