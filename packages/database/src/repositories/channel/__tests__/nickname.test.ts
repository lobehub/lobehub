// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { workspaceMembers } from '../../../schemas';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-nickname');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const sendInput = { content: 'Hello', requestKey: 'hello', routing: 'decision' as const };

/** `mia` goes by "Kuro" in the fixture workspace; the owner set no nickname. */
const seedNicknames = () =>
  db.insert(workspaceMembers).values([
    { role: 'owner', userId: fixture.ownerId, workspaceId: fixture.workspaceId },
    {
      config: { nickname: 'Kuro' },
      role: 'member',
      userId: fixture.memberId,
      workspaceId: fixture.workspaceId,
    },
  ]);

describe('workspace nicknames in Channels', () => {
  it('names message authors and members by their workspace nickname', async () => {
    await seedNicknames();
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    await asMember.send(channel.id, sendInput);

    const view = await asOwner.detail(channel.id);

    expect(view.messages.at(-1)?.author).toMatchObject({ id: fixture.memberId, name: 'Kuro' });
    const people = view.members.filter((member) => member.actorType === 'user');
    expect(people.find((member) => member.userId === fixture.memberId)?.userName).toBe('Kuro');
    // Without a nickname the account name stays.
    expect(people.find((member) => member.userId === fixture.ownerId)?.userName).toBe(
      'Olivia Owner',
    );

    const listed = (await asOwner.list()).find((item) => item.id === channel.id);
    expect(listed?.lastMessage?.author).toMatchObject({ name: 'Kuro' });
  });

  it('falls back to the account name once the nickname is cleared or the member leaves', async () => {
    await seedNicknames();
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    await asMember.send(channel.id, sendInput);
    await db.update(workspaceMembers).set({ config: { nickname: '  ' } });

    const view = await asOwner.detail(channel.id);

    // `mia` has no full name, so the client falls back to the handle.
    expect(view.messages.at(-1)?.author).toMatchObject({ name: 'mia' });
  });
});
