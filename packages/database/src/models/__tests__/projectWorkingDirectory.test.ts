import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProjectDirectoryRepository } from '../../repositories/projectDirectory';
import {
  agents,
  devices,
  environmentInstances,
  environments,
  projectEnvironments,
  projects,
  projectWorkingDirectories,
  topics,
  users,
} from '../../schemas';
import {
  normalizeProjectDirectory,
  ProjectWorkingDirectoryModel,
} from '../projectWorkingDirectory';
import { TopicModel } from '../topic';

const db = await getTestDB();
const userId = 'directory-user';
const otherUserId = 'other-directory-user';
const model = new ProjectWorkingDirectoryModel(db, userId);
const other = new ProjectWorkingDirectoryModel(db, otherUserId);
const repo = new ProjectDirectoryRepository(db, userId);
const base = {
  deviceId: 'directory-device',
  name: 'Repo',
  path: '/work/repo',
  projectId: 'directory-project',
};

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(agents).values([
    { id: 'directory-agent', userId },
    { id: 'directory-coordinator', userId },
  ]);
  await db.insert(projects).values({
    coordinatorAgentId: 'directory-coordinator',
    id: base.projectId,
    identifier: 'DIR',
    name: 'Directory project',
    userId,
  });
  await db
    .insert(devices)
    .values({ deviceId: base.deviceId, identitySource: 'fallback', platform: 'linux', userId });
});
afterEach(async () => {
  await db.delete(topics);
  await db.delete(projectWorkingDirectories);
  await db.delete(projectEnvironments);
  await db.delete(environmentInstances);
  await db.delete(environments);
  await db.delete(users);
});

/** A conversation pinned to a directory the way the start-topic flow pins it. */
const createPinnedTopic = (directory: { id: string }) =>
  new TopicModel(db, userId).create({
    agentId: 'directory-agent',
    metadata: {
      boundDeviceId: base.deviceId,
      workingDirectory: base.path,
      workingDirectoryConfig: { path: base.path },
    },
    projectId: base.projectId,
    projectWorkingDirectoryId: directory.id,
    title: 'Work',
  });

describe('project directory queries', () => {
  it('keeps legacy directories visible but refuses to resolve them', async () => {
    const [device] = await db.select().from(devices);
    const [legacy] = await db
      .insert(projectWorkingDirectories)
      .values({
        projectId: base.projectId,
        deviceId: device.id,
        path: base.path,
        name: base.name,
        addedByUserId: userId,
      })
      .returning();
    expect((await model.list())[0]).toMatchObject({
      id: legacy.id,
      instanceId: null,
      path: base.path,
    });
    await expect(model.resolve(legacy.id)).rejects.toThrow('Link this directory');
    expect(await model.listTopics(legacy.id)).toEqual([]);
  });

  it('allows reading conversations in a read-only directory but blocks execution', async () => {
    const directory = await repo.bind(base);
    await createPinnedTopic(directory);
    await db
      .update(projectWorkingDirectories)
      .set({ permission: 'readOnly' })
      .where(eq(projectWorkingDirectories.id, directory.id));
    expect(await model.listTopics(directory.id)).toHaveLength(1);
    await expect(model.resolve(directory.id)).rejects.toThrow('read-only');
  });

  it('does not expose another user’s directories', async () => {
    const directory = await repo.bind(base);
    expect(await other.list()).toEqual([]);
    await expect(other.resolve(directory.id)).rejects.toThrow();
    await expect(other.listTopics(directory.id)).rejects.toThrow();
  });

  it('keeps agentless conversations visible in directory listings', async () => {
    const directory = await repo.bind(base);
    const topic = await new TopicModel(db, userId).create({
      projectId: base.projectId,
      projectWorkingDirectoryId: directory.id,
      title: 'Agentless',
    });
    expect(await model.listTopics(directory.id)).toEqual([
      expect.objectContaining({ agentId: null, agentTitle: null, id: topic.id }),
    ]);
  });

  it('keeps a colliding legacy directory visible when another project upgrades first', async () => {
    await db.insert(agents).values({ id: 'directory-coordinator-2', userId });
    await db.insert(projects).values({
      coordinatorAgentId: 'directory-coordinator-2',
      id: 'second-project',
      identifier: 'SEC',
      name: 'Second project',
      userId,
    });
    const [device] = await db.select().from(devices);
    await db.insert(projectWorkingDirectories).values([
      {
        addedByUserId: userId,
        deviceId: device.id,
        name: 'First',
        path: base.path,
        projectId: base.projectId,
      },
      {
        addedByUserId: userId,
        deviceId: device.id,
        name: 'Second',
        path: base.path,
        projectId: 'second-project',
      },
    ]);
    await repo.bind(base);
    const rows = await model.list();
    expect(rows).toHaveLength(2);
    const legacy = rows.find((row) => row.projectId === 'second-project')!;
    expect(legacy).toMatchObject({
      configuration: null,
      environmentId: null,
      instanceId: null,
      path: base.path,
    });
    await expect(model.resolve(legacy.id)).rejects.toThrow('Link this directory');
  });

  it('returns the project icon and leading agent metadata with directory topics', async () => {
    await db.update(projects).set({ avatar: '📦' }).where(eq(projects.id, base.projectId));
    await db
      .update(agents)
      .set({ title: 'Design Agent', avatar: '🎨' })
      .where(eq(agents.id, 'directory-agent'));
    const directory = await repo.bind(base);
    const topic = await createPinnedTopic(directory);
    expect((await model.list())[0].projectAvatar).toBe('📦');
    expect(await model.listTopics(directory.id)).toEqual([
      expect.objectContaining({
        id: topic.id,
        agentId: 'directory-agent',
        agentTitle: 'Design Agent',
        agentAvatar: '🎨',
      }),
    ]);
  });
});

describe('resolveForTopic', () => {
  it('follows the pinned directory even after the agent default device changes', async () => {
    const directory = await repo.bind(base);
    const topic = await createPinnedTopic(directory);
    expect(topic).toMatchObject({
      projectId: base.projectId,
      projectWorkingDirectoryId: directory.id,
      metadata: { boundDeviceId: base.deviceId, workingDirectory: base.path },
    });
    await db
      .update(agents)
      .set({ agencyConfig: { boundDeviceId: 'some-other-device', executionTarget: 'device' } })
      .where(eq(agents.id, 'directory-agent'));
    expect(await model.resolveForTopic(topic.id)).toMatchObject({
      deviceId: base.deviceId,
      path: base.path,
    });
  });

  it('blocks disabled environments and a removed directory instead of falling back', async () => {
    const directory = await repo.bind(base);
    const topic = await createPinnedTopic(directory);
    const row = await model.resolve(directory.id);
    await db
      .update(environments)
      .set({ enabled: false })
      .where(eq(environments.id, row.environmentId));
    await expect(model.resolveForTopic(topic.id)).rejects.toThrow('disabled');
    await db
      .delete(projectWorkingDirectories)
      .where(eq(projectWorkingDirectories.id, directory.id));
    await expect(model.resolveForTopic(topic.id)).rejects.toThrow('no longer exists');
  });

  it('returns nothing for conversations without a project pin', async () => {
    const topic = await new TopicModel(db, userId).create({
      agentId: 'directory-agent',
      title: 'Plain',
    });
    expect(await model.resolveForTopic(topic.id)).toBeUndefined();
  });

  it('leaves plain device-bound conversations to the device-resolution path', async () => {
    const topic = await new TopicModel(db, userId).create({
      agentId: 'directory-agent',
      metadata: { boundDeviceId: base.deviceId, workingDirectory: base.path },
      title: 'Device chat',
    });
    expect(await model.resolveForTopic(topic.id)).toBeUndefined();
  });

  it('resolves legacy topics whose metadata path is not canonical', async () => {
    const directory = await repo.bind(base);
    const topic = await new TopicModel(db, userId).create({
      agentId: 'directory-agent',
      metadata: { workingDirectory: '/work/./repo' },
      projectId: base.projectId,
      projectWorkingDirectoryId: directory.id,
      title: 'Legacy',
    });
    expect(await model.resolveForTopic(topic.id)).toMatchObject({ id: directory.id });
  });
});

describe('topic projections', () => {
  it('includes project bindings in the slim sidebar topic projection', async () => {
    const directory = await repo.bind(base);
    const topic = await createPinnedTopic(directory);
    const page = await new TopicModel(db, userId).query({ agentId: 'directory-agent' });
    expect(page.items.find((item) => item.id === topic.id)).toMatchObject({
      projectId: base.projectId,
      projectWorkingDirectoryId: directory.id,
    });
  });
});

it('normalizes directory paths per platform', () => {
  expect(normalizeProjectDirectory('C:\\work\\repo\\', 'win32')).toBe('C:\\work\\repo');
  expect(() => normalizeProjectDirectory('relative/path', 'linux')).toThrow();
});
