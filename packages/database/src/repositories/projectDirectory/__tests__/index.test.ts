import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { EnvironmentModel } from '../../../models/environment';
import { ProjectModel } from '../../../models/project';
import { ProjectWorkingDirectoryModel } from '../../../models/projectWorkingDirectory';
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
} from '../../../schemas';
import { ProjectDirectoryRepository } from '../index';

const db = await getTestDB();
const userId = 'directory-repo-user';
const otherUserId = 'other-directory-repo-user';
const repo = new ProjectDirectoryRepository(db, userId);
const otherRepo = new ProjectDirectoryRepository(db, otherUserId);
const directoryModel = new ProjectWorkingDirectoryModel(db, userId);
const base = {
  deviceId: 'repo-device',
  name: 'Repo',
  path: '/work/repo',
  projectId: 'repo-project',
};

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(agents).values([
    { id: 'repo-agent', userId },
    { id: 'repo-coordinator', userId },
  ]);
  await db.insert(projects).values({
    coordinatorAgentId: 'repo-coordinator',
    id: base.projectId,
    identifier: 'REP',
    name: 'Repository project',
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

describe('ProjectDirectoryRepository.bind', () => {
  it('links an ordinary folder and reuses the instance and project binding', async () => {
    const first = await repo.bind(base);
    const second = await repo.bind({ ...base, path: '/work/repo/' });
    expect(second.id).toBe(first.id);
    expect(await db.select().from(environmentInstances)).toHaveLength(1);
    expect(await db.select().from(environments)).toHaveLength(1);
    expect((await directoryModel.list())[0]).toMatchObject({
      configuration: {},
      path: '/work/repo',
      projectId: base.projectId,
    });
  });

  it('upgrades a legacy directory binding in place', async () => {
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
    const upgraded = await repo.bind(base);
    expect(upgraded.id).toBe(legacy.id);
    expect((await directoryModel.resolve(legacy.id)).instanceId).toBeTruthy();
  });

  it('records GitHub configuration and keeps the instance snapshot stable', async () => {
    const directory = await repo.bind({
      ...base,
      repositoryUrl: 'git@github.com:lobehub/lobehub.git',
    });
    const row = await directoryModel.resolve(directory.id);
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
      repo.bind({ ...base, repositoryUrl: 'https://github.com/other/repo' }),
    ).rejects.toThrow('Repository differs');
  });

  it('isolates devices even when their path matches', async () => {
    await db
      .insert(devices)
      .values({ deviceId: 'second-device', identitySource: 'fallback', userId });
    await repo.bind(base);
    await repo.bind({ ...base, deviceId: 'second-device' });
    expect(await directoryModel.list()).toHaveLength(2);
  });

  it('resolves the instance configuration snapshot, not later environment edits', async () => {
    const directory = await repo.bind({
      ...base,
      repositoryUrl: 'https://github.com/lobehub/lobehub',
    });
    const row = await directoryModel.resolve(directory.id);
    await db
      .update(environments)
      .set({ configuration: { sources: [{ kind: 'git', url: 'https://github.com/other/repo' }] } })
      .where(eq(environments.id, row.environmentId));
    expect((await directoryModel.resolve(directory.id)).configuration).toEqual({
      sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobehub' }],
    });
  });

  it('does not expose or change another user’s project or device', async () => {
    await repo.bind(base);
    await expect(otherRepo.bind(base)).rejects.toThrow('access denied');
    await db.insert(devices).values({
      deviceId: 'private-device',
      identitySource: 'fallback',
      userId: otherUserId,
    });
    await expect(repo.bind({ ...base, deviceId: 'private-device' })).rejects.toThrow();
  });

  it('reuses an attached environment and keeps its instance snapshot across updates', async () => {
    const projectModel = new ProjectModel(db, userId);
    const env = await new EnvironmentModel(db, userId).save({
      name: 'Shared GitHub',
      repositoryUrl: 'git@github.com:lobehub/lobehub.git',
    });
    await projectModel.attachEnvironment(base.projectId, env.id);
    const binding = await repo.bind({ ...base, environmentId: env.id });
    const bound = await directoryModel.resolve(binding.id);
    const [before] = await db
      .select()
      .from(environmentInstances)
      .where(eq(environmentInstances.id, bound.instanceId!));
    await new EnvironmentModel(db, userId).save({
      id: env.id,
      name: 'Updated resource',
      repositoryUrl: 'https://github.com/lobehub/new-repo',
    });
    const [after] = await db
      .select()
      .from(environmentInstances)
      .where(eq(environmentInstances.id, bound.instanceId!));
    expect(after.configurationSnapshot).toEqual(before.configurationSnapshot);
  });

  it('rejects filing conversations for an agent fixed to another execution target', async () => {
    await db
      .update(agents)
      .set({
        agencyConfig: {
          boundDeviceId: 'other-device',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'fixed',
        },
      })
      .where(eq(agents.id, 'repo-agent'));
    await db.insert(topics).values({
      id: 'fixed-agent-topic',
      agentId: 'repo-agent',
      userId,
      metadata: { workingDirectory: base.path },
    });
    await expect(
      repo.bind({ ...base, agentId: 'repo-agent', topicIds: ['fixed-agent-topic'] }),
    ).rejects.toThrow('execution target');
    const [topic] = await db.select().from(topics).where(eq(topics.id, 'fixed-agent-topic'));
    expect(topic.projectId).toBeNull();
  });

  it('files explicit conversations and rolls back mismatched selections', async () => {
    await db.insert(topics).values([
      {
        id: 'matching',
        agentId: 'repo-agent',
        userId,
        metadata: { workingDirectory: base.path },
      },
      {
        id: 'other-path',
        agentId: 'repo-agent',
        userId,
        metadata: { workingDirectory: '/other' },
      },
    ]);
    await expect(
      repo.bind({ ...base, agentId: 'repo-agent', topicIds: ['matching', 'other-path'] }),
    ).rejects.toThrow('different directory');
    expect(await directoryModel.list()).toEqual([]);
    const directory = await repo.bind({ ...base, agentId: 'repo-agent', topicIds: ['matching'] });
    expect(await directoryModel.listTopics(directory.id)).toHaveLength(1);
  });
});

describe('ProjectDirectoryRepository.associateTopic', () => {
  it('associates an existing conversation without changing its agent or metadata', async () => {
    await db.insert(topics).values({
      id: 'existing',
      agentId: 'repo-agent',
      userId,
      metadata: { workingDirectory: undefined },
    });
    await repo.associateTopic(base.projectId, 'existing');
    const [topic] = await db.select().from(topics).where(eq(topics.id, 'existing'));
    expect(topic).toMatchObject({
      projectId: base.projectId,
      agentId: 'repo-agent',
      metadata: {},
      projectWorkingDirectoryId: null,
    });
    await expect(otherRepo.associateTopic(base.projectId, 'existing')).rejects.toThrow(
      'access denied',
    );
  });

  it('refuses running topics and mismatched execution locations without partially changing ownership', async () => {
    const directory = await repo.bind(base);
    await db.insert(topics).values([
      { id: 'running', agentId: 'repo-agent', userId, status: 'running' },
      {
        id: 'different-path',
        agentId: 'repo-agent',
        userId,
        metadata: { workingDirectory: '/elsewhere' },
      },
    ]);
    await expect(repo.associateTopic(base.projectId, 'running')).rejects.toThrow('running');
    await expect(
      repo.associateTopic(base.projectId, 'different-path', directory.id),
    ).rejects.toThrow('existing device');
    expect((await db.select().from(topics)).every((t) => t.projectId === null)).toBe(true);
  });

  it('pins the topic to the directory device and path when associating with a directory', async () => {
    const directory = await repo.bind(base);
    await db.insert(topics).values({
      id: 'to-pin',
      agentId: 'repo-agent',
      userId,
      metadata: { workingDirectory: base.path },
    });
    await repo.associateTopic(base.projectId, 'to-pin', directory.id);
    const [topic] = await db.select().from(topics).where(eq(topics.id, 'to-pin'));
    expect(topic).toMatchObject({
      projectId: base.projectId,
      projectWorkingDirectoryId: directory.id,
      metadata: {
        boundDeviceId: base.deviceId,
        workingDirectory: base.path,
        workingDirectoryConfig: { path: base.path },
      },
    });
  });

  it('accepts a non-canonical but equivalent topic path when associating', async () => {
    const directory = await repo.bind(base);
    await db.insert(topics).values({
      id: 'legacy-path',
      agentId: 'repo-agent',
      userId,
      metadata: { workingDirectory: '/work//repo/' },
    });
    await repo.associateTopic(base.projectId, 'legacy-path', directory.id);
    const [topic] = await db.select().from(topics).where(eq(topics.id, 'legacy-path'));
    expect(topic.metadata).toMatchObject({
      boundDeviceId: base.deviceId,
      workingDirectory: base.path,
      workingDirectoryConfig: { path: base.path },
    });
  });
});
