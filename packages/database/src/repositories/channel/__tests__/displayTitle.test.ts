// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channels, projects, workspaceMembers } from '../../../schemas';
import { trashStamp } from '../../../utils/softDelete';
import { ChannelRepository, projectDefaultChannelMetadata, withDisplayTitle } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-display-title');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(async () => {
  await db.delete(projects).where(eq(projects.workspaceId, fixture.workspaceId));
  await fixture.cleanup();
});

const owner = () => new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);

/** Project "Lobot" with its default Channel, and another Channel named General in it. */
const lobot = async () => {
  const [project] = await db
    .insert(projects)
    .values({ name: 'Lobot', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
    .returning();
  const { channel: main } = await owner().create({
    metadata: projectDefaultChannelMetadata(),
    projectId: project.id,
    title: 'General',
  });
  const { channel: other } = await owner().create({ projectId: project.id, title: 'General' });
  return { main, other, project };
};

const displayTitleOf = async (channelId: string) =>
  (await owner().list()).find(({ id }) => id === channelId)?.displayTitle;

describe('Channel display titles', () => {
  it("shows a project's default Channel under the project's name, others under their title", async () => {
    const { main, other } = await lobot();
    const { channel: workspace } = await owner().create({ title: 'General' });

    const list = await owner().list();

    expect(Object.fromEntries(list.map(({ displayTitle, id }) => [id, displayTitle]))).toEqual({
      [main.id]: 'Lobot',
      [other.id]: 'General',
      [workspace.id]: 'General',
    });
    expect(list.find(({ id }) => id === main.id)?.title).toBe('General');
  });

  it('follows a project rename without touching the Channel', async () => {
    const { main, project } = await lobot();

    await db.update(projects).set({ name: 'Lobot 2' }).where(eq(projects.id, project.id));

    expect(await displayTitleOf(main.id)).toBe('Lobot 2');
  });

  it('keeps the mark and the project name when the Channel is renamed', async () => {
    const { main } = await lobot();

    await owner().rename(main.id, 'Lobby');

    expect(await displayTitleOf(main.id)).toBe('Lobot');
    const [row] = await db.select().from(channels).where(eq(channels.id, main.id));
    expect(row).toMatchObject({ metadata: { projectDefault: true }, title: 'Lobby' });
  });

  it('falls back to the title once the project is trashed or has no name', async () => {
    const { main, project } = await lobot();

    await db.update(projects).set({ name: '  ' }).where(eq(projects.id, project.id));
    expect(await displayTitleOf(main.id)).toBe('General');

    await db
      .update(projects)
      .set({ name: 'Lobot', ...trashStamp(new Date()) })
      .where(eq(projects.id, project.id));
    expect(await displayTitleOf(main.id)).toBe('General');
  });

  it('falls back to the title for a marked Channel whose project is gone', async () => {
    const marked = { metadata: projectDefaultChannelMetadata(), title: 'General' };

    expect(await withDisplayTitle(db, { ...marked, projectId: 'pro_missing' })).toMatchObject({
      displayTitle: 'General',
    });
    expect(await withDisplayTitle(db, { ...marked, projectId: null })).toMatchObject({
      displayTitle: 'General',
    });
  });

  it('names a joinable public default Channel after its project', async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: 'Lobot', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const { channel } = await owner().create({
      metadata: projectDefaultChannelMetadata(),
      projectId: project.id,
      title: 'General',
      visibility: 'public',
    });
    const teammate = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);

    const joinable = await teammate.listJoinable();

    expect(joinable).toEqual([
      expect.objectContaining({ displayTitle: 'Lobot', id: channel.id, title: 'General' }),
    ]);
    expect(joinable[0]).not.toHaveProperty('metadata');
  });
});
