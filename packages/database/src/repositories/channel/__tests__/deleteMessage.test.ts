// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-delete-message');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const execution = new ChannelExecutionRepository(db);

describe('ChannelRepository.deleteMessage', () => {
  it('leaves a tombstone every member sees, without text or mentions', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const sent = await asMember.send(channel.id, {
      content: 'Oops',
      requestKey: 'oops',
      routing: 'fallback',
    });

    await asMember.deleteMessage(channel.id, sent.id);

    const [seen] = (await asOwner.detail(channel.id)).messages;
    expect(seen).toMatchObject({ content: '', fileIds: [], id: sent.id, mentions: [] });
    expect(seen.deletedAt).toBeInstanceOf(Date);
    // Deleting again changes nothing.
    await expect(asMember.deleteMessage(channel.id, sent.id)).resolves.toEqual([]);
  });

  it('lets only the author or an admin delete', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const ownerMessage = await asOwner.send(channel.id, {
      content: 'Owner',
      requestKey: 'owner',
      routing: 'fallback',
    });
    const memberMessage = await asMember.send(channel.id, {
      content: 'Member',
      requestKey: 'member',
      routing: 'fallback',
    });

    await expect(asMember.deleteMessage(channel.id, ownerMessage.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(asOwner.deleteMessage(channel.id, memberMessage.id)).resolves.toEqual([]);
  });

  it('stops the replies the message asked for', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Device Agent');
    const sent = await asOwner.send(channel.id, {
      content: 'Do it',
      requestKey: 'work',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, sent.id);
    await execution.claim(channel.id, job.id, lease);

    const writers = await asOwner.deleteMessage(channel.id, sent.id);

    expect(writers.map((writer) => writer.id)).toEqual([job.id]);
    const [stopped] = await jobsOf(db, sent.id);
    expect(stopped).toMatchObject({ publicationRevoked: true, status: 'cancelled' });
  });

  it('stops the run that already absorbed a deleted request into its batch', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Device Agent');
    const send = async (content: string) => {
      const message = await asOwner.send(channel.id, {
        content,
        requestKey: content,
        routing: 'fallback',
      });
      const [job] = await jobsOf(db, message.id);
      return { job, message };
    };

    const first = await send('first');
    await execution.claim(channel.id, first.job.id, lease);
    const second = await send('second');
    const third = await send('third');
    await execution.accepted(channel.id, first.job.id);
    await execution.saveDraft(channel.id, first.job.id, 'First answer');
    await execution.publish(channel.id, first.job.id);
    await execution.releaseWriter(channel.id, first.job.id);

    const claim = await execution.claim(channel.id, second.job.id, lease);
    expect(claim?.job.manifest?.requestMessageIds).toEqual([second.message.id, third.message.id]);
    // The third request is answered by that run, so no job row points at it any more.
    expect((await jobById(db, third.job.id)).status).toBe('merged');

    const writers = await asOwner.deleteMessage(channel.id, third.message.id);

    expect(writers.map((writer) => writer.id)).toEqual([second.job.id]);
    expect(await jobById(db, second.job.id)).toMatchObject({
      publicationRevoked: true,
      status: 'cancelled',
    });
  });

  it('queues the other absorbed requests again when the run that owns them is deleted', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Device Agent');
    const send = async (content: string) => {
      const message = await asOwner.send(channel.id, {
        content,
        requestKey: content,
        routing: 'fallback',
      });
      const [job] = await jobsOf(db, message.id);
      return { job, message };
    };

    const first = await send('first');
    await execution.claim(channel.id, first.job.id, lease);
    const second = await send('second');
    const third = await send('third');
    await execution.accepted(channel.id, first.job.id);
    await execution.saveDraft(channel.id, first.job.id, 'First answer');
    await execution.publish(channel.id, first.job.id);
    await execution.releaseWriter(channel.id, first.job.id);

    await execution.claim(channel.id, second.job.id, lease);
    expect((await jobById(db, third.job.id)).status).toBe('merged');

    await asOwner.deleteMessage(channel.id, second.message.id);

    expect(await jobById(db, second.job.id)).toMatchObject({
      publicationRevoked: true,
      status: 'cancelled',
    });
    // The withdrawn request takes only its own answer away: the other one still gets a run.
    expect((await jobById(db, third.job.id)).status).toBe('queued');
  });

  it('refuses to edit a tombstone back into a message', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const sent = await asMember.send(channel.id, {
      content: 'Oops',
      requestKey: 'oops',
      routing: 'fallback',
    });

    await asMember.deleteMessage(channel.id, sent.id);

    await expect(asMember.editMessage(channel.id, sent.id, 'Back again')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const [seen] = (await asOwner.detail(channel.id)).messages;
    expect(seen).toMatchObject({ content: '', deletedAt: expect.any(Date), id: sent.id });
  });

  it('refuses to route a deleted message again', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');
    const sent = await asOwner.send(channel.id, {
      content: 'Who knows?',
      requestKey: 'who',
      routing: 'decision',
    });

    // A pending message deleted before routing finished is left `unassigned`, which is exactly
    // the status `retryRouting` accepts.
    await asOwner.deleteMessage(channel.id, sent.id);

    await expect(asOwner.retryRouting(channel.id, sent.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const [kept] = (await asOwner.detail(channel.id)).messages;
    expect(kept).toMatchObject({ content: '', deletedAt: expect.any(Date), id: sent.id });
  });
});
