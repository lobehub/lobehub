// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { userContactRequests, users, workspaceMembers } from '../../../schemas';
import { tableContacts } from './tableContacts';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-card', tableContacts);
beforeEach(async () => {
  await fixture.setup();
  // Cards check the address book, which counts fellow workspace members.
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: fixture.ownerId, workspaceId: fixture.workspaceId },
    { role: 'member', userId: fixture.memberId, workspaceId: fixture.workspaceId },
  ]);
});
afterEach(async () => {
  await db.delete(userContactRequests);
  await fixture.cleanup();
});

describe('a contact card message', () => {
  it('stores the server snapshot and writes the text fallback itself', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const sent = await asOwner.send(channel.id, {
      card: { type: 'user', userId: fixture.memberId },
      content: '',
      requestKey: 'card',
      routing: 'fallback',
    });

    expect(sent.content).toBe('[Contact card] mia');
    expect(sent.kind).toBe('contact');
    const [seen] = (await asOwner.detail(channel.id)).messages;
    expect(seen.card).toEqual({
      avatar: null,
      name: 'mia',
      type: 'user',
      userId: fixture.memberId,
      username: 'mia',
    });
  });

  it('refuses a person the sender may not share, and attachments', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await expect(
      asOwner.send(channel.id, {
        card: { type: 'user', userId: 'nobody' },
        content: '',
        requestKey: 'stranger',
        routing: 'fallback',
      }),
    ).rejects.toThrow('Share only your contacts');
    await expect(
      asOwner.send(channel.id, {
        card: { type: 'user', userId: fixture.memberId },
        content: '',
        fileIds: ['file'],
        requestKey: 'files',
        routing: 'fallback',
      }),
    ).rejects.toThrow('A card goes without attachments');
  });

  it('matches a retry by the contact, not its snapshot', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const input = {
      card: { type: 'user' as const, userId: fixture.memberId },
      content: '',
      requestKey: 'retry',
      routing: 'fallback' as const,
    };
    const sent = await asOwner.send(channel.id, input);
    // A rename since the first attempt does not turn the retry into a conflict.
    await db.update(users).set({ fullName: 'Mia Renamed' }).where(eq(users.id, fixture.memberId));

    await expect(asOwner.send(channel.id, input)).resolves.toMatchObject({
      content: '[Contact card] mia',
      id: sent.id,
    });
    await expect(
      asOwner.send(channel.id, { ...input, card: { type: 'user', userId: fixture.ownerId } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('drops the card with the message', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const sent = await asMember.send(channel.id, {
      card: { type: 'user', userId: fixture.ownerId },
      content: '',
      requestKey: 'gone',
      routing: 'fallback',
    });
    await asMember.deleteMessage(channel.id, sent.id);

    const [seen] = (await asOwner.detail(channel.id)).messages;
    expect(seen.card).toBeNull();
  });
});
