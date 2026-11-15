// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelExecutionRepository } from '@/database/repositories/channel';
import {
  createChannelFixture,
  jobsOf,
  lease,
} from '@/database/repositories/channel/__tests__/testUtils';
import { channelMessages, workspaceMembers } from '@/database/schemas';

import { deliverRelayReceipt } from './relayReceipt';

vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./mention', () => ({ notifyChannelMentions: vi.fn() }));
vi.mock('./routingConfig', () => ({ resolveChannelRoutingConfig: vi.fn() }));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-relay-receipt');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.memberId });
});
afterEach(fixture.cleanup);

/**
 * The member asked the Relayer in "Source" to pass a message to the Answerer in "Platform"; the
 * Answerer replies there.
 */
const relayAndAnswer = async ({ withOrigin = true } = {}) => {
  const source = await fixture.createTeamChannel('Source');
  const relayer = await fixture.addAgent(source.channel.id, 'Relayer');
  const target = await fixture.createTeamChannel('Platform');
  const answerer = await fixture.addAgent(target.channel.id, 'Answerer');
  const relayed = await target.asMember.send(target.channel.id, {
    content: '@Answerer please look at T-1',
    mentions: [answerer.id],
    metadata: {
      via: {
        agentId: relayer.agentId,
        name: 'Relayer',
        ...(withOrigin && { origin: { channelId: source.channel.id, threadId: null } }),
      },
    },
    requestKey: 'agent-relay:op:call',
    routing: 'decision',
  });
  const [job] = await jobsOf(db, relayed.id);
  await execution.claim(target.channel.id, job.id, lease);
  await execution.accepted(target.channel.id, job.id);
  await execution.saveDraft(target.channel.id, job.id, 'Taking it: the panel can reuse Portal.');
  const replyMessageId = await execution.publish(target.channel.id, job.id);
  return { answerer, job, relayer, replyMessageId, source, target };
};

const sourceMessages = (channelId: string) =>
  db.select().from(channelMessages).where(eq(channelMessages.channelId, channelId));

describe('deliverRelayReceipt', () => {
  it('brings the reply back to the relaying Agent where the relay came from, once', async () => {
    const { answerer, job, relayer, replyMessageId, source, target } = await relayAndAnswer();
    const params = { channelId: target.channel.id, jobId: job.id, replyMessageId };

    await deliverRelayReceipt(db, params);
    await deliverRelayReceipt(db, params);

    const [receipt, ...others] = await sourceMessages(source.channel.id);
    expect(others).toEqual([]);
    expect(receipt).toMatchObject({
      content: '@Relayer Taking it: the panel can reuse Portal.',
      mentions: [relayer.id],
      metadata: {
        receipt: {
          channelId: target.channel.id,
          channelTitle: 'Platform',
          messageId: replyMessageId,
        },
        via: { agentId: answerer.agentId, name: 'Answerer' },
      },
      routingStatus: 'directed',
      threadId: null,
      userId: fixture.memberId,
    });
    // The relaying Agent is woken to report back.
    expect((await jobsOf(db, receipt.id)).map(({ memberId }) => memberId)).toEqual([relayer.id]);
  });

  it('sends nothing for a request without a relay origin', async () => {
    const { job, replyMessageId, source, target } = await relayAndAnswer({ withOrigin: false });
    await deliverRelayReceipt(db, { channelId: target.channel.id, jobId: job.id, replyMessageId });
    expect(await sourceMessages(source.channel.id)).toEqual([]);
  });
});
