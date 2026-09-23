// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { environmentInstances, environments, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { EnvironmentModel } from '../environment';
import { EnvironmentInstanceModel } from '../environmentInstance';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'environment-visibility-owner';
const memberId = 'environment-visibility-member';
const workspaceId = 'environment-visibility-workspace';

const owner = new EnvironmentModel(serverDB, ownerId, workspaceId);
const member = new EnvironmentModel(serverDB, memberId, workspaceId);
const ownerInstances = new EnvironmentInstanceModel(serverDB, ownerId, workspaceId);
const memberInstances = new EnvironmentInstanceModel(serverDB, memberId, workspaceId);

/** One instance of the given environment, bound to a sandbox rather than a device. */
const addInstance = async (environmentId: string, workingDirectory: string) => {
  const [row] = await serverDB
    .insert(environmentInstances)
    .values({
      configurationSnapshot: {},
      environmentId,
      kind: 'sandbox',
      name: workingDirectory,
      provider: 'test-provider',
      providerResourceId: workingDirectory,
      providerScope: 'test-scope',
      workingDirectory,
    })
    .returning();

  return row;
};

// Both foreign keys restrict, so the teardown has to unwind in the order the
// rows were built: instances, then environments, then the workspace and users.
const reset = async () => {
  await serverDB.delete(environmentInstances);
  await serverDB.delete(environments);
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(inArray(users.id, [ownerId, memberId]));
};

beforeEach(async () => {
  await reset();
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: workspaceId, name: 'Team', primaryOwnerId: ownerId, slug: workspaceId }]);
});

afterEach(reset);

describe('environment creator', () => {
  it('keeps the creator of a row whose author has no avatar', async () => {
    // Regression: the creator was selected as a nested object across the join,
    // and drizzle nullifies such an object when its FIRST field is null. Sorted
    // alphabetically that field was `avatar`, so every author without one
    // vanished from the listing and their rows rendered as "Unknown".
    await serverDB
      .update(users)
      .set({ avatar: null, fullName: 'No Avatar Owner' })
      .where(eq(users.id, ownerId));
    await owner.create({ name: 'Analysis' });

    const [row] = await owner.query();
    expect(row.creator).toMatchObject({ avatar: null, fullName: 'No Avatar Owner', id: ownerId });
  });

  it('carries the avatar through when the author has one', async () => {
    await serverDB
      .update(users)
      .set({ avatar: 'https://example.com/a.png' })
      .where(eq(users.id, ownerId));
    await owner.create({ name: 'Analysis' });

    const [row] = await owner.query();
    expect(row.creator).toMatchObject({ avatar: 'https://example.com/a.png', id: ownerId });
  });
});

describe('environment visibility', () => {
  it('keeps a new environment private, so nothing is shared by being created', async () => {
    const created = await owner.create({ name: 'Analysis' });

    expect(created.visibility).toBe('private');
    await expect(member.query()).resolves.toEqual([]);
  });

  it('shows a published environment to another member, and hides it again', async () => {
    const created = await owner.create({ name: 'Analysis' });

    await owner.setVisibility(created.id, 'public');
    const visible = await member.query();
    expect(visible.map((row) => row.id)).toEqual([created.id]);

    await owner.setVisibility(created.id, 'private');
    await expect(member.query()).resolves.toEqual([]);
  });

  it('narrows the listing to one pool, where private still means your own', async () => {
    const mine = await owner.create({ name: 'Mine' });
    const theirs = await member.create({ name: 'Theirs' });
    await member.setVisibility(theirs.id, 'public');

    const published = await owner.query('public');
    expect(published.map((row) => row.id)).toEqual([theirs.id]);

    const privatePool = await owner.query('private');
    expect(privatePool.map((row) => row.id)).toEqual([mine.id]);
  });

  it('refuses every write on an environment the caller does not own', async () => {
    const created = await owner.create({ name: 'Analysis' });
    await owner.setVisibility(created.id, 'public');

    // Readable — that is what publishing means.
    await expect(member.findById(created.id)).resolves.toMatchObject({ id: created.id });

    // And nothing more than readable.
    await expect(member.findOwnedById(created.id)).resolves.toBeUndefined();
    await expect(member.update(created.id, { name: 'Renamed' })).resolves.toBeUndefined();
    await expect(member.setVisibility(created.id, 'private')).resolves.toBeUndefined();
    await expect(member.delete(created.id)).resolves.toBeUndefined();

    const [row] = await serverDB.select().from(environments).where(eq(environments.id, created.id));
    expect(row).toMatchObject({ name: 'Analysis', visibility: 'public' });
  });

  it('lets a member read the instances of a published environment but not destroy them', async () => {
    const created = await owner.create({ name: 'Analysis' });
    const instance = await addInstance(created.id, 'work');

    // Private: the instance is not even visible.
    await expect(memberInstances.findById(instance.id)).resolves.toBeUndefined();

    await owner.setVisibility(created.id, 'public');

    // Published: readable, because running in it is the point.
    await expect(memberInstances.findById(instance.id)).resolves.toMatchObject({ id: instance.id });
    await expect(memberInstances.query()).resolves.toHaveLength(1);

    // The destructive paths resolve through the owner-scoped lookup instead, so
    // a member cannot reach the execution plane's delete with a row it may not
    // remove — which would leave captured state nobody can name.
    await expect(memberInstances.findOwnedById(instance.id)).resolves.toBeUndefined();
    await expect(memberInstances.delete(instance.id)).resolves.toBeUndefined();
    await expect(ownerInstances.findOwnedById(instance.id)).resolves.toMatchObject({
      id: instance.id,
    });
  });

  // A workspace-public agent runs on its caller's session. Even the creator's
  // own private instance is out of its reach, since what a session left in it
  // can include the creator's credentials; a published one stays usable.
  it('keeps even your own private instances out of reach of a public agent', async () => {
    const privateEnv = await owner.create({ name: 'Private' });
    const privateInstance = await addInstance(privateEnv.id, 'secret');
    const publishedEnv = await owner.create({ name: 'Published', visibility: 'public' });
    const publishedInstance = await addInstance(publishedEnv.id, 'shared');

    const asPublicAgent = new EnvironmentInstanceModel(serverDB, ownerId, workspaceId, 'public');
    const asPrivateAgent = new EnvironmentInstanceModel(serverDB, ownerId, workspaceId, 'private');

    await expect(asPublicAgent.findById(privateInstance.id)).resolves.toBeUndefined();
    await expect(asPublicAgent.findById(publishedInstance.id)).resolves.toMatchObject({
      id: publishedInstance.id,
    });
    await expect(asPublicAgent.query()).resolves.toHaveLength(1);

    await expect(asPrivateAgent.findById(privateInstance.id)).resolves.toMatchObject({
      id: privateInstance.id,
    });
  });

  // Personal agents carry 'public' by default without it meaning anything, and
  // every personal environment is private — narrowing there would hide them all.
  it('leaves personal environments reachable whatever the agent says', async () => {
    const personal = new EnvironmentModel(serverDB, ownerId);
    const created = await personal.create({ name: 'Personal' });
    const instance = await addInstance(created.id, 'personal');

    const asPublicAgent = new EnvironmentInstanceModel(serverDB, ownerId, undefined, 'public');
    await expect(asPublicAgent.findById(instance.id)).resolves.toMatchObject({ id: instance.id });
  });

  it('refuses to publish a personal environment, which has nobody to publish to', async () => {
    const personal = new EnvironmentModel(serverDB, ownerId);
    const created = await personal.create({ name: 'Personal', visibility: 'public' });

    expect(created.visibility).toBe('private');
    await expect(personal.setVisibility(created.id, 'public')).resolves.toBeUndefined();
  });

  it('answers the published pool with nothing when there is no workspace to publish to', async () => {
    const personal = new EnvironmentModel(serverDB, ownerId);
    await personal.create({ name: 'Personal' });

    // Not "every row", which is what an ignored filter would have returned —
    // and what would make two tabs look like the same list.
    await expect(personal.query('public')).resolves.toEqual([]);
    await expect(personal.query('private')).resolves.toHaveLength(1);
  });

  it('keeps a workspace listing clear of your own personal environments', async () => {
    const personal = new EnvironmentModel(serverDB, ownerId);
    await personal.create({ name: 'Personal' });
    const inWorkspace = await owner.create({ name: 'In workspace' });

    const rows = await owner.query();
    expect(rows.map((row) => row.id)).toEqual([inWorkspace.id]);
  });
});
