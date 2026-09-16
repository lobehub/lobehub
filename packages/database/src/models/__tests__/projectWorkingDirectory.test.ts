import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
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
  normalizeProjectRepository,
  ProjectWorkingDirectoryModel,
} from '../projectWorkingDirectory';
import { TopicModel } from '../topic';

const db = await getTestDB();
const userId = 'directory-user';
const model = new ProjectWorkingDirectoryModel(db, userId);
const other = new ProjectWorkingDirectoryModel(db, 'other-directory-user');
const base = {
  deviceId: 'directory-device',
  name: 'Repo',
  path: '/work/repo',
  projectId: 'directory-project',
};

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: 'other-directory-user' }]);
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

describe('project directory bindings', () => {
  it('links an ordinary folder and reuses the instance and project binding', async () => {
    const first = await model.bind(base);
    const second = await model.bind({ ...base, path: '/work/repo/' });
    expect(second.id).toBe(first.id);
    expect(await db.select().from(environmentInstances)).toHaveLength(1);
    expect(await db.select().from(environments)).toHaveLength(1);
    expect((await model.list())[0]).toMatchObject({
      configuration: {},
      path: '/work/repo',
      projectId: base.projectId,
    });
  });
  it('keeps legacy directories visible and upgrades their binding without losing topics', async () => {
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
    const upgraded = await model.bind(base);
    expect(upgraded.id).toBe(legacy.id);
    expect((await model.resolve(legacy.id)).instanceId).toBeTruthy();
  });
  it('allows reading conversations in a read-only directory but blocks execution', async () => {
    const directory = await model.bind(base);
    await model.startTopic(directory.id, 'directory-agent', 'Work');
    await db
      .update(projectWorkingDirectories)
      .set({ permission: 'readOnly' })
      .where(eq(projectWorkingDirectories.id, directory.id));
    expect(await model.listTopics(directory.id)).toHaveLength(1);
    await expect(model.startTopic(directory.id, 'directory-agent', 'Write')).rejects.toThrow(
      'read-only',
    );
  });
  it('records GitHub configuration and keeps the instance snapshot', async () => {
    const directory = await model.bind({
      ...base,
      repositoryUrl: 'git@github.com:lobehub/lobehub.git',
    });
    const row = await model.resolve(directory.id);
    expect(row.configuration).toEqual({
      sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobehub' }],
    });
    await db
      .update(environments)
      .set({ configuration: {} })
      .where(eq(environments.id, row.environmentId));
    const [instance] = await db.select().from(environmentInstances);
    expect(instance.configurationSnapshot).toEqual(row.configuration);
    await expect(
      model.bind({ ...base, repositoryUrl: 'https://github.com/other/repo' }),
    ).rejects.toThrow('Repository differs');
  });
  it('isolates devices even when their path matches', async () => {
    await db
      .insert(devices)
      .values({ deviceId: 'second-device', identitySource: 'fallback', userId });
    await model.bind(base);
    await model.bind({ ...base, deviceId: 'second-device' });
    expect(await model.list()).toHaveLength(2);
  });
  it('does not expose or change another user’s project or device', async () => {
    const directory = await model.bind(base);
    expect(await other.list()).toEqual([]);
    await expect(other.resolve(directory.id)).rejects.toThrow();
    await expect(other.bind(base)).rejects.toThrow();
    await expect(other.startTopic(directory.id, 'directory-agent', 'Work')).rejects.toThrow();
    await db.insert(devices).values({
      deviceId: 'private-device',
      identitySource: 'fallback',
      userId: 'other-directory-user',
    });
    await expect(model.bind({ ...base, deviceId: 'private-device' })).rejects.toThrow();
  });
  it('includes project bindings in the slim sidebar topic projection', async () => {
    const directory = await model.bind(base);
    const topic = await model.startTopic(directory.id, 'directory-agent', 'Work');
    const page = await new TopicModel(db, userId).query({ agentId: 'directory-agent' });
    expect(page.items.find((item) => item.id === topic.id)).toMatchObject({
      projectId: base.projectId,
      projectWorkingDirectoryId: directory.id,
    });
  });
  it('pins new conversations without changing the agent default', async () => {
    const directory = await model.bind(base);
    const topic = await model.startTopic(directory.id, 'directory-agent', 'Work');
    expect(topic).toMatchObject({
      projectId: base.projectId,
      projectWorkingDirectoryId: directory.id,
      metadata: { projectExecution: { deviceId: base.deviceId }, workingDirectory: base.path },
    });
    await db
      .update(agents)
      .set({ agencyConfig: { boundDeviceId: 'some-other-device', executionTarget: 'device' } })
      .where(eq(agents.id, 'directory-agent'));
    expect(await model.resolveForTopic(topic.id)).toMatchObject({
      deviceId: base.deviceId,
      path: base.path,
    });
    expect(await model.listTopics(directory.id)).toHaveLength(1);
  });
  it('files explicit conversations and rolls back mismatched selections', async () => {
    await db.insert(topics).values([
      {
        id: 'matching',
        agentId: 'directory-agent',
        userId,
        metadata: { workingDirectory: base.path },
      },
      {
        id: 'other-path',
        agentId: 'directory-agent',
        userId,
        metadata: { workingDirectory: '/other' },
      },
    ]);
    await expect(
      model.bind({ ...base, agentId: 'directory-agent', topicIds: ['matching', 'other-path'] }),
    ).rejects.toThrow('different directory');
    expect(await model.list()).toEqual([]);
    const directory = await model.bind({
      ...base,
      agentId: 'directory-agent',
      topicIds: ['matching'],
    });
    expect(await model.listTopics(directory.id)).toHaveLength(1);
  });
  it('blocks disabled environments and a removed directory instead of falling back', async () => {
    const directory = await model.bind(base);
    const topic = await model.startTopic(directory.id, 'directory-agent', 'Work');
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
});

it('rejects credentials, clone options and non-repository URLs', () => {
  for (const value of [
    'https://token@github.com/a/b',
    'https://github.com/a/b?token=x',
    'https://example.com/a/b',
    'https://github.com/a/b/tree/main',
    '--upload-pack=x',
  ])
    expect(() => normalizeProjectRepository(value)).toThrow();
  expect(normalizeProjectDirectory('C:\\work\\repo\\', 'win32')).toBe('C:\\work\\repo');
  expect(() => normalizeProjectDirectory('relative/path', 'linux')).toThrow();
});

describe('project environment settings', () => {
  it('creates an abstract environment before a directory exists and links it to a project', async () => {
    const env = await model.saveEnvironment({
      name: 'Shared GitHub',
      repositoryUrl: 'git@github.com:lobehub/lobehub.git',
    });
    expect(await model.listEnvironments()).toEqual([expect.objectContaining({ id: env.id })]);
    expect(await model.listEnvironments(base.projectId)).toEqual([]);
    await model.attachEnvironment(base.projectId, env.id);
    expect(await model.listEnvironments(base.projectId)).toEqual([
      expect.objectContaining({ id: env.id }),
    ]);
    const binding = await model.bind({ ...base, environmentId: env.id });
    const [before] = await db
      .select()
      .from(environmentInstances)
      .where(eq(environmentInstances.id, binding.environmentInstanceId!));
    await model.saveEnvironment({
      id: env.id,
      name: 'Updated resource',
      repositoryUrl: 'https://github.com/lobehub/new-repo',
    });
    const [after] = await db
      .select()
      .from(environmentInstances)
      .where(eq(environmentInstances.id, binding.environmentInstanceId!));
    expect(after.configurationSnapshot).toEqual(before.configurationSnapshot);
    expect((await model.listEnvironments(base.projectId))[0].name).toBe('Updated resource');
    expect(await other.listEnvironments()).toEqual([]);
    await expect(other.saveEnvironment({ id: env.id, name: 'Denied' })).rejects.toThrow(
      'access denied',
    );
    await expect(other.attachEnvironment(base.projectId, env.id)).rejects.toThrow('access denied');
  });
  it('returns the project icon and leading agent metadata with directory topics', async () => {
    await db.update(projects).set({ avatar: '📦' }).where(eq(projects.id, base.projectId));
    await db
      .update(agents)
      .set({ title: 'Design Agent', avatar: '🎨' })
      .where(eq(agents.id, 'directory-agent'));
    const binding = await model.bind(base);
    const topic = await model.startTopic(binding.id, 'directory-agent', 'Draft the plan');
    expect((await model.list())[0].projectAvatar).toBe('📦');
    expect(await model.listTopics(binding.id)).toEqual([
      expect.objectContaining({
        id: topic.id,
        agentId: 'directory-agent',
        agentTitle: 'Design Agent',
        agentAvatar: '🎨',
      }),
    ]);
  });
});
