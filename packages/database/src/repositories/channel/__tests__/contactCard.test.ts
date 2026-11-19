// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { findContactCardMessage } from '../contactCard';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-contact-card');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(fixture.cleanup);

const card = {
  type: 'user' as const,
  user: { avatar: null, fullName: 'Max', id: 'someone', username: 'max' },
};

const setup = async () => {
  const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await owner.create({ title: 'Cards' });
  const sent = await owner.send(channel.id, {
    content: '[Contact card] Max (@max)',
    metadata: { contactCard: card },
    requestKey: 'card',
    routing: 'fallback',
  });
  const text = await owner.send(channel.id, {
    content: 'plain',
    requestKey: 'plain',
    routing: 'fallback',
  });
  return { channel, owner, sent, text };
};

describe('contact card messages', () => {
  it('finds the card a message carries and who sent it', async () => {
    const { channel, sent, text } = await setup();
    await expect(findContactCardMessage(db, channel.id, sent.id)).resolves.toEqual({
      card,
      senderId: fixture.ownerId,
    });
    await expect(findContactCardMessage(db, channel.id, text.id)).resolves.toBeUndefined();
    await expect(findContactCardMessage(db, channel.id, 'not-a-uuid')).resolves.toBeUndefined();
  });

  it('finds no card once the message is deleted', async () => {
    const { channel, owner, sent } = await setup();
    await owner.deleteMessage(channel.id, sent.id);
    await expect(findContactCardMessage(db, channel.id, sent.id)).resolves.toBeUndefined();
  });

  it('cannot be edited, since its text describes the card', async () => {
    const { channel, owner, sent } = await setup();
    await expect(owner.editMessage(channel.id, sent.id, 'something else')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
