// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { ChannelRepository } from '../index';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-sections');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel sections', () => {
  it('keeps each person their own sections, in order', async () => {
    const { asMember, asOwner } = await fixture.createTeamChannel();

    const work = await asOwner.sections.create('Work');
    const later = await asOwner.sections.create('Later');
    expect((await asOwner.sections.list()).map(({ name }) => name)).toEqual(['Work', 'Later']);

    await asOwner.sections.reorder([later.id, work.id]);
    await asOwner.sections.update(work.id, { collapsed: true, name: 'Projects' });
    expect(await asOwner.sections.list()).toEqual([
      expect.objectContaining({ id: later.id, name: 'Later' }),
      expect.objectContaining({ collapsed: true, id: work.id, name: 'Projects' }),
    ]);

    // Another person, or the same person in their personal space, sees none of them.
    expect(await asMember.sections.list()).toEqual([]);
    expect(await new ChannelRepository(db, fixture.ownerId).sections.list()).toEqual([]);
    await expect(asMember.sections.update(work.id, { name: 'Mine' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asMember.sections.reorder([work.id])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asMember.sections.remove(work.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('files a conversation for the caller only and returns it when the section goes', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const work = await asOwner.sections.create('Work');

    await expect(asOwner.moveToSection(channel.id, work.id)).resolves.toBe(work.id);
    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ id: channel.id, sectionId: work.id }),
    ]);
    expect(await asMember.list()).toEqual([
      expect.objectContaining({ id: channel.id, sectionId: null }),
    ]);

    // Nobody files a conversation under someone else's section.
    await expect(asMember.moveToSection(channel.id, work.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await asOwner.sections.remove(work.id);
    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ id: channel.id, sectionId: null }),
    ]);
  });

  it('hides a conversation for the caller until the next message', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();

    await expect(asOwner.setHidden(channel.id, true)).resolves.toBe(true);
    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ hidden: true, id: channel.id }),
    ]);
    expect(await asMember.list()).toEqual([
      expect.objectContaining({ hidden: false, id: channel.id }),
    ]);

    await asMember.send(channel.id, { content: 'Hi', requestKey: 'hi', routing: 'fallback' });
    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ hidden: false, id: channel.id }),
    ]);
  });
});
