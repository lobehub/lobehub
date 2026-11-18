// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

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
