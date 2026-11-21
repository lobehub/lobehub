// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, channelJobs } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-retry-job');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const execution = new ChannelExecutionRepository(db);

/**
 * A reply claimed and failed with `error`; `released` settles its writer as a stop would, and
 * `draft` makes the run accept its input and save a final answer before it fails.
 */
const failedReply = async (
  error: Record<string, unknown>,
  {
    draft,
    released = true,
    sender = 'owner',
  }: { draft?: string; released?: boolean; sender?: 'member' | 'owner' } = {},
) => {
  const team = await fixture.createTeamChannel();
  await fixture.addAgent(team.channel.id, 'Device Agent');
  const message = await (sender === 'owner' ? team.asOwner : team.asMember).send(team.channel.id, {
    content: 'hi',
    requestKey: `retry-${sender}`,
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, message.id);
  await execution.claim(team.channel.id, job.id, lease);
  if (draft !== undefined) {
    await execution.accepted(team.channel.id, job.id);
    await execution.saveDraft(team.channel.id, job.id, draft);
  }
  const [claimed] = await db.select().from(channelJobs).where(eq(channelJobs.id, job.id));
  await db
    .update(agentOperations)
    .set({ error, status: 'error' })
    .where(eq(agentOperations.id, claimed.operationId!));
  await execution.fail(team.channel.id, job.id, { message: 'Agent could not start' });
  if (released) await execution.releaseWriter(team.channel.id, job.id);
  return { ...team, failed: claimed, message };
};

const deviceUnreachable = {
  deviceRoute: { deviceId: 'device-1' },
  message: 'The device this agent runs on is offline',
  type: 'DeviceGatewayNotConfigured',
};

const modelError = { message: 'Unsupported model', type: 'ProviderBizError' };

describe('Retrying a failed reply', () => {
  it('queues the same delivery again, and a new claim runs it on a fresh operation', async () => {
    const { asOwner, channel, failed } = await failedReply(deviceUnreachable);

    const retried = await asOwner.retryJob(channel.id, failed.id);
    expect(retried).toMatchObject({
      id: failed.id,
      operationId: null,
      publicationRevoked: false,
      status: 'queued',
      writerHeld: false,
    });
    expect((await asOwner.detail(channel.id)).jobs[0]).toMatchObject({
      errorType: null,
      status: 'queued',
    });

    const claim = await execution.claim(channel.id, failed.id, lease);
    expect(claim?.job.status).toBe('running');
    expect(claim?.job.operationId).not.toBe(failed.operationId);
  });

  it('lets the requester retry their own reply but no other member', async () => {
    const own = await failedReply(deviceUnreachable, { sender: 'member' });
    await expect(own.asMember.retryJob(own.channel.id, own.failed.id)).resolves.toMatchObject({
      status: 'queued',
    });
    await fixture.cleanup();
    await fixture.setup();

    const other = await failedReply(deviceUnreachable);
    await expect(other.asMember.retryJob(other.channel.id, other.failed.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it.each([
    ['a model error', modelError],
    ['an exhausted quota', { message: 'Quota exceeded', type: 'InsufficientQuota' }],
    ['a timeout', { message: 'The run timed out', type: 'AgentRuntimeError' }],
  ])('queues a reply that failed with %s, and runs it on a fresh operation', async (_, error) => {
    const { asOwner, channel, failed } = await failedReply(error);

    await expect(asOwner.retryJob(channel.id, failed.id)).resolves.toMatchObject({
      id: failed.id,
      operationId: null,
      status: 'queued',
    });

    const claim = await execution.claim(channel.id, failed.id, lease);
    expect(claim?.job.status).toBe('running');
    expect(claim?.job.operationId).not.toBe(failed.operationId);
  });

  it('discards the unpublished draft of a run that got further, so the new run answers afresh', async () => {
    const { asOwner, channel, failed } = await failedReply(modelError, { draft: 'half an answer' });

    const retried = await asOwner.retryJob(channel.id, failed.id);
    expect(retried).toMatchObject({
      acceptedAt: null,
      draft: null,
      publicationRevoked: false,
      status: 'queued',
    });

    await execution.claim(channel.id, failed.id, lease);
    await execution.accepted(channel.id, failed.id);
    await execution.saveDraft(channel.id, failed.id, 'the full answer');
    const replyId = await execution.publish(channel.id, failed.id);

    const { messages } = await asOwner.detail(channel.id);
    const replies = messages.filter((m) => m.replyToId === retried.messageId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ content: 'the full answer', id: replyId });
  });

  it('refuses a second retry of the same reply, so it is never queued twice', async () => {
    const { asOwner, channel, failed } = await failedReply(modelError);

    await asOwner.retryJob(channel.id, failed.id);
    await expect(asOwner.retryJob(channel.id, failed.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses a reply that was published', async () => {
    const team = await fixture.createTeamChannel();
    await fixture.addAgent(team.channel.id, 'Device Agent');
    const message = await team.asOwner.send(team.channel.id, {
      content: 'hi',
      requestKey: 'retry-published',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    await execution.claim(team.channel.id, job.id, lease);
    await execution.accepted(team.channel.id, job.id);
    await execution.saveDraft(team.channel.id, job.id, 'done');
    await execution.publish(team.channel.id, job.id);

    await expect(team.asOwner.retryJob(team.channel.id, job.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses a reply whose writer has not been released yet', async () => {
    const { asOwner, channel, failed } = await failedReply(deviceUnreachable, { released: false });
    await expect(asOwner.retryJob(channel.id, failed.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses to retry a reply whose request was deleted', async () => {
    const { asOwner, channel, failed, message } = await failedReply(deviceUnreachable);

    await asOwner.deleteMessage(channel.id, message.id);

    await expect(asOwner.retryJob(channel.id, failed.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await asOwner.detail(channel.id)).jobs[0]).toMatchObject({ status: 'failed' });
  });
});
