// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-edit-message');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(fixture.cleanup);

const setup = async () => {
  const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await owner.create({ title: 'Edits' });
  await owner.addUser(channel.id, fixture.memberId);
  const member = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
  const sent = await owner.send(channel.id, {
    content: 'Helo',
    requestKey: 'typo',
    routing: 'fallback',
  });
  return { channel, member, owner, sent };
};

describe('ChannelRepository.editMessage', () => {
  it('rewrites the author’s own text and marks it edited for every member', async () => {
    const { channel, member, owner, sent } = await setup();
    expect((await owner.detail(channel.id)).messages[0].editedAt).toBeNull();

    const edited = await owner.editMessage(channel.id, sent.id, '  Hello  ');
    expect(edited).toMatchObject({ content: 'Hello', id: sent.id });
    expect(edited.editedAt).toBeInstanceOf(Date);

    const [seen] = (await member.detail(channel.id)).messages;
    expect(seen).toMatchObject({ content: 'Hello', mentions: sent.mentions });
    expect(seen.editedAt).toEqual(edited.editedAt);
  });

  it('leaves an unchanged message unmarked', async () => {
    const { channel, owner, sent } = await setup();
    expect((await owner.editMessage(channel.id, sent.id, 'Helo')).editedAt).toBeNull();
    expect((await owner.detail(channel.id)).messages[0].editedAt).toBeNull();
  });

  it('refuses someone else’s message, even for an admin', async () => {
    const { channel, owner } = await setup();
    const member = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    const theirs = await member.send(channel.id, {
      content: 'Mine',
      requestKey: 'member',
      routing: 'fallback',
    });
    await expect(owner.editMessage(channel.id, theirs.id, 'Changed')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses clearing the text of a message with no attachments', async () => {
    const { channel, owner, sent } = await setup();
    await expect(owner.editMessage(channel.id, sent.id, '   ')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
