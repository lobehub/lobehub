// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { channelMessageReplyError } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelExecutionRepository } from '@/database/repositories/channel';
import {
  createChannelFixture,
  jobsOf,
  lease,
} from '@/database/repositories/channel/__tests__/testUtils';
import { agentOperations, channelMessages } from '@/database/schemas';

import { reportChannelReplyFailure } from '.';

vi.mock('../notify', () => ({ notifyChannel: vi.fn() }));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reply-error-report');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const notify = vi.fn().mockResolvedValue(undefined);

/** The member asks the Coder in Chinese; the run then ends with `operation`. */
const failedReply = async (operation: {
  error?: Record<string, unknown>;
  interruption?: { canResume: boolean; interruptedAt: string; reason: string };
  status: 'abandoned' | 'error' | 'interrupted';
}) => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Coder');
  const message = await team.asMember.send(team.channel.id, {
    content: '昨天的部署为什么失败了？',
    mentions: [agent.id],
    requestKey: 'req-deploy',
    routing: 'decision',
  });
  const [job] = await jobsOf(db, message.id);
  const claim = await execution.claim(team.channel.id, job.id, lease);
  await execution.accepted(team.channel.id, job.id);
  await db
    .update(agentOperations)
    .set(operation)
    .where(eq(agentOperations.id, claim!.job.operationId!));
  await execution.fail(team.channel.id, job.id, {
    message: 'Agent execution ended without a reply',
  });
  await execution.releaseWriter(team.channel.id, job.id);
  return { ...team, job, operationId: claim!.job.operationId! };
};

const cardIn = async (channelId: string) => {
  const rows = await db
    .select()
    .from(channelMessages)
    .where(eq(channelMessages.channelId, channelId))
    .orderBy(channelMessages.sequence);
  return rows.filter((row) => channelMessageReplyError(row.metadata));
};

const abandoned = {
  error: { message: 'Operation abandoned: inactivity_watchdog' },
  status: 'abandoned' as const,
};

describe('reportChannelReplyFailure', () => {
  it('posts the rule-based card in the request language, then the model refines it in place', async () => {
    const { channel, job, operationId } = await failedReply(abandoned);
    const summarizer = vi.fn().mockResolvedValue({
      actions: ['resume', 'retry', 'switch_device'],
      summary: 'Coder 卡在等待命令结果上，一个小时没有动静。',
    });

    const reported = await reportChannelReplyFailure(db, channel.id, job.id, {
      createSummarizer: () => summarizer,
      notify,
    });

    const [rule] = await cardIn(channel.id);
    expect(rule.id).toBe(reported?.messageId);
    expect(channelMessageReplyError(rule.metadata)).toMatchObject({
      actions: ['resume', 'retry'],
      attempts: 1,
      errorMessage: 'Operation abandoned: inactivity_watchdog',
      jobId: job.id,
      operationId,
      summary: 'Coder 长时间没有进展，这次回复被系统中止了。',
    });

    expect(await reported?.refinement).toBe(true);
    expect(summarizer).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedActions: ['resume', 'retry'],
        errorMessage: 'Operation abandoned: inactivity_watchdog',
        lastStep: 'no events at all after it started',
        locale: 'zh-CN',
      }),
      expect.any(AbortSignal),
    );
    const [refined] = await cardIn(channel.id);
    expect(refined).toMatchObject({
      content: 'Coder 卡在等待命令结果上，一个小时没有动静。',
      id: rule.id,
      sequence: rule.sequence,
    });
    // Only actions the server allowed survive.
    expect(channelMessageReplyError(refined.metadata)?.actions).toEqual(['resume', 'retry']);
  });

  it('keeps the rule-based card when the model fails or is slow', async () => {
    const { channel, job } = await failedReply(abandoned);

    const failing = await reportChannelReplyFailure(db, channel.id, job.id, {
      createSummarizer: () => () => Promise.reject(new Error('provider down')),
      notify,
    });
    expect(await failing?.refinement).toBe(false);

    const [card] = await cardIn(channel.id);
    expect(card.content).toBe('Coder 长时间没有进展，这次回复被系统中止了。');
  });

  it('reports one run once', async () => {
    const { channel, job } = await failedReply(abandoned);
    await reportChannelReplyFailure(db, channel.id, job.id, { createSummarizer: false, notify });
    const again = await reportChannelReplyFailure(db, channel.id, job.id, {
      createSummarizer: false,
      notify,
    });

    expect(again?.refinement).toBeUndefined();
    const cards = await cardIn(channel.id);
    expect(cards).toHaveLength(1);
    expect(channelMessageReplyError(cards[0].metadata)?.attempts).toBe(1);
  });

  it('writes nothing for a run a person stopped from its conversation', async () => {
    const { channel, job } = await failedReply({
      interruption: { canResume: true, interruptedAt: new Date().toISOString(), reason: 'user' },
      status: 'interrupted',
    });

    expect(await reportChannelReplyFailure(db, channel.id, job.id, { notify })).toBeUndefined();
    expect(await cardIn(channel.id)).toEqual([]);
  });

  it('writes nothing for a reply the Channel stopped', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Coder');
    const message = await team.asMember.send(team.channel.id, {
      content: 'hi',
      mentions: [agent.id],
      requestKey: 'req-stop',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, message.id);
    await execution.claim(team.channel.id, job.id, lease);
    await team.asMember.stop(team.channel.id, { jobId: job.id });

    expect(
      await reportChannelReplyFailure(db, team.channel.id, job.id, { notify }),
    ).toBeUndefined();
    expect(await cardIn(team.channel.id)).toEqual([]);
  });
});
