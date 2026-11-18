import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { EnvironmentModel } from '../../../models/environment';
import { ProjectModel } from '../../../models/project';
import { UserModel } from '../../../models/user';
import {
  agents,
  devices,
  environmentInstances,
  environments,
  projectEnvironments,
  projects,
  projectWorkingDirectories,
  users,
  workspaces,
} from '../../../schemas';
import { WorkspaceDeletionRepository } from '../../workspaceDeletion';
import { mergeRepositories, ProjectEnvironmentRepository } from '../index';

const db = await getTestDB();
const userId = 'project-env-user';
const otherUserId = 'project-env-other';
const repo = new ProjectEnvironmentRepository(db, userId);

const insertProject = async (id: string, name = id) => {
  await db
    .insert(agents)
    .values({ id: `${id}-agent`, userId })
    .onConflictDoNothing();
  const [project] = await db
    .insert(projects)
    .values({ coordinatorAgentId: `${id}-agent`, id, name, userId })
    .returning();
  return project;
};

const insertEnvironment = async (name: string, urls: string[]) => {
  const [environment] = await db
    .insert(environments)
    .values({
      configuration: { kind: 'code', sources: urls.map((url) => ({ kind: 'git' as const, url })) },
      name,
      userId,
    })
    .returning();
  return environment;
};

const link = (
  projectId: string,
  environmentId: string,
  extra: { isDefault?: boolean; sortOrder?: number } = {},
) => db.insert(projectEnvironments).values({ environmentId, projectId, ...extra });

const linksOf = (projectId: string) =>
  db.select().from(projectEnvironments).where(eq(projectEnvironments.projectId, projectId));

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await db.delete(projectWorkingDirectories);
  await db.delete(projectEnvironments);
  await db.delete(environmentInstances);
  await db.delete(environments);
  await db.delete(projects);
  await db.delete(devices);
  await db.delete(agents);
  await db.delete(workspaces);
  await db.delete(users);
});

describe('mergeRepositories', () => {
  it('appends missing repositories and lays several out side by side', () => {
    const merged = mergeRepositories(
      { sources: [{ kind: 'git', url: 'https://github.com/a/one' }] },
      [
        { sources: [{ kind: 'git', url: 'https://github.com/a/one' }] },
        { sources: [{ kind: 'git', ref: 'dev', url: 'https://github.com/a/two.git' }] },
      ],
    );
    expect(merged.sources).toEqual([
      { kind: 'git', path: 'one', url: 'https://github.com/a/one' },
      { kind: 'git', path: 'two', ref: 'dev', url: 'https://github.com/a/two.git' },
    ]);
  });

  it('returns the same object when there is nothing to add', () => {
    const into = { sources: [{ kind: 'git' as const, url: 'https://github.com/a/one' }] };
    expect(mergeRepositories(into, [into, null])).toBe(into);
  });
});

describe('ProjectEnvironmentRepository.ensure (existing projects)', () => {
  it('gives a project with no environment an empty one of its own', async () => {
    const project = await insertProject('empty');

    const environment = await repo.get(project.id);

    expect(environment).toMatchObject({ name: 'empty', projectId: project.id });
    expect(environment.configuration.sources ?? []).toEqual([]);
    expect(await linksOf(project.id)).toEqual([
      expect.objectContaining({ environmentId: environment.id, isDefault: true }),
    ]);
  });

  it('takes over an environment only this project links, merging the others into it', async () => {
    const project = await insertProject('legacy');
    const main = await insertEnvironment('main', ['https://github.com/a/main']);
    const extra = await insertEnvironment('extra', ['https://github.com/a/extra']);
    await link(project.id, extra.id, { sortOrder: 0 });
    await link(project.id, main.id, { isDefault: true, sortOrder: 1 });

    const environment = await repo.get(project.id);

    expect(environment.id).toBe(main.id);
    expect(environment.projectId).toBe(project.id);
    expect(environment.configuration.sources).toEqual([
      { kind: 'git', path: 'main', url: 'https://github.com/a/main' },
      { kind: 'git', path: 'extra', url: 'https://github.com/a/extra' },
    ]);
    expect(await linksOf(project.id)).toEqual([
      expect.objectContaining({ environmentId: main.id, isDefault: true }),
    ]);
    // Nothing is deleted: the environment it stopped linking stays standalone.
    const [kept] = await db.select().from(environments).where(eq(environments.id, extra.id));
    expect(kept.projectId).toBeNull();
    expect((await new EnvironmentModel(db, userId).query()).map((row) => row.id)).toEqual([
      extra.id,
    ]);
  });

  it('makes a new environment from one another project shares, leaving the other project alone', async () => {
    const first = await insertProject('first');
    const second = await insertProject('second');
    const shared = await insertEnvironment('shared', ['https://github.com/a/shared']);
    await link(first.id, shared.id, { isDefault: true });
    await link(second.id, shared.id, { isDefault: true });

    const environment = await repo.get(first.id);

    expect(environment.id).not.toBe(shared.id);
    expect(environment.configuration.sources).toEqual([
      { kind: 'git', url: 'https://github.com/a/shared' },
    ]);
    expect(await linksOf(second.id)).toEqual([
      expect.objectContaining({ environmentId: shared.id }),
    ]);

    // The second one, now the only project linking it, takes it over.
    expect((await repo.get(second.id)).id).toBe(shared.id);
  });

  it("moves a folder used only by this project to the project's environment", async () => {
    const project = await insertProject('folders');
    const other = await insertProject('other-folders');
    const main = await insertEnvironment('main', []);
    const extra = await insertEnvironment('extra', ['https://github.com/a/extra']);
    await link(project.id, main.id, { isDefault: true });
    await link(project.id, extra.id);
    await link(other.id, extra.id);
    const [device] = await db
      .insert(devices)
      .values({ deviceId: 'env-device', identitySource: 'fallback', platform: 'linux', userId })
      .returning();
    const instance = (path: string) => ({
      configurationSnapshot: {},
      deviceId: device.id,
      environmentId: extra.id,
      kind: 'device' as const,
      name: path,
      workingDirectory: path,
    });
    const [mine, shared] = await db
      .insert(environmentInstances)
      .values([instance('/work/mine'), instance('/work/shared')])
      .returning();
    await db.insert(projectWorkingDirectories).values([
      { deviceId: device.id, name: 'mine', path: '/work/mine', projectId: project.id },
      { deviceId: device.id, name: 'shared', path: '/work/shared', projectId: project.id },
      { deviceId: device.id, name: 'shared', path: '/work/shared', projectId: other.id },
    ]);

    const environment = await repo.get(project.id);

    const rows = await db.select().from(environmentInstances);
    expect(rows.find((row) => row.id === mine.id)?.environmentId).toBe(environment.id);
    expect(rows.find((row) => row.id === shared.id)?.environmentId).toBe(extra.id);
  });

  it('keeps the link to an environment holding a folder shared with another project', async () => {
    const project = await insertProject('shared-folder');
    const other = await insertProject('shared-folder-other');
    const main = await insertEnvironment('main', []);
    const extra = await insertEnvironment('extra', ['https://github.com/a/extra']);
    await link(project.id, main.id, { isDefault: true });
    await link(project.id, extra.id);
    await link(other.id, extra.id, { isDefault: true });
    const [device] = await db
      .insert(devices)
      .values({ deviceId: 'shared-device', identitySource: 'fallback', platform: 'linux', userId })
      .returning();
    const [instance] = await db
      .insert(environmentInstances)
      .values({
        configurationSnapshot: {},
        deviceId: device.id,
        environmentId: extra.id,
        kind: 'device',
        name: 'shared',
        workingDirectory: '/work/shared',
      })
      .returning();
    await db.insert(projectWorkingDirectories).values([
      { deviceId: device.id, name: 'shared', path: '/work/shared', projectId: project.id },
      { deviceId: device.id, name: 'shared', path: '/work/shared', projectId: other.id },
    ]);

    const environment = await repo.get(project.id);

    // The folder stays where it was built, and this project still reaches it.
    const [row] = await db
      .select()
      .from(environmentInstances)
      .where(eq(environmentInstances.id, instance.id));
    expect(row.environmentId).toBe(extra.id);
    expect(await linksOf(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ environmentId: environment.id, isDefault: true }),
        expect.objectContaining({ environmentId: extra.id, isDefault: false }),
      ]),
    );
    // Settled as it is: reading again changes nothing.
    expect((await repo.get(project.id)).id).toBe(environment.id);
    expect(await linksOf(project.id)).toHaveLength(2);
  });

  it('moves a folder that a link names as its default instance', async () => {
    const project = await insertProject('default-instance');
    const main = await insertEnvironment('main', []);
    const extra = await insertEnvironment('extra', ['https://github.com/a/extra']);
    const [device] = await db
      .insert(devices)
      .values({ deviceId: 'default-device', identitySource: 'fallback', platform: 'linux', userId })
      .returning();
    const [instance] = await db
      .insert(environmentInstances)
      .values({
        configurationSnapshot: {},
        deviceId: device.id,
        environmentId: extra.id,
        kind: 'device',
        name: 'mine',
        workingDirectory: '/work/default',
      })
      .returning();
    await link(project.id, main.id, { isDefault: true });
    await db
      .insert(projectEnvironments)
      .values({ defaultInstanceId: instance.id, environmentId: extra.id, projectId: project.id });
    await db.insert(projectWorkingDirectories).values({
      deviceId: device.id,
      name: 'mine',
      path: '/work/default',
      projectId: project.id,
    });

    const environment = await repo.get(project.id);

    const [row] = await db
      .select()
      .from(environmentInstances)
      .where(eq(environmentInstances.id, instance.id));
    expect(row.environmentId).toBe(environment.id);
  });

  it("follows the project's name after a rename", async () => {
    const project = await insertProject('renamed', 'Before');
    await repo.get(project.id);
    await db.update(projects).set({ name: 'After' }).where(eq(projects.id, project.id));

    expect((await repo.get(project.id)).name).toBe('After');
  });

  it('is idempotent and changes nothing on a settled project', async () => {
    const project = await insertProject('settled');
    const first = await repo.get(project.id);
    const second = await repo.get(project.id);

    expect(second).toEqual(first);
    expect(await db.select().from(environments)).toHaveLength(1);
    expect(await linksOf(project.id)).toHaveLength(1);
  });
});

describe('ProjectEnvironmentRepository.update', () => {
  it('lets whoever may change the project edit its environment, and nobody else', async () => {
    const project = await insertProject('editable');
    await repo.get(project.id);

    const updated = await repo.update(project.id, {
      configuration: {
        bootstrapCommand: 'pnpm i',
        sources: [
          { kind: 'git', url: 'https://github.com/a/one' },
          { kind: 'git', path: 'two', url: 'https://github.com/a/two' },
        ],
      },
    });
    expect(updated.configuration.sources).toHaveLength(2);
    expect(updated.configuration.bootstrapCommand).toBe('pnpm i');

    const stranger = new ProjectEnvironmentRepository(db, otherUserId);
    await expect(stranger.update(project.id, { configuration: {} })).rejects.toThrow(
      'access denied',
    );
    await expect(stranger.get(project.id)).rejects.toThrow('access denied');
  });

  it('is refused by the standalone environment writes', async () => {
    const project = await insertProject('guarded');
    const environment = await repo.get(project.id);
    const model = new EnvironmentModel(db, userId);

    expect(await model.update(environment.id, { name: 'renamed' })).toBeUndefined();
    expect(await model.delete(environment.id)).toBeUndefined();
  });
});

describe('ProjectEnvironmentRepository.addRepositories', () => {
  it('adds only the repositories the environment does not check out yet', async () => {
    const project = await insertProject('adds');
    await repo.update(project.id, {
      configuration: { sources: [{ kind: 'git', url: 'https://github.com/a/one' }] },
    });

    const environment = await repo.addRepositories(project.id, [
      { sources: [{ kind: 'git', url: 'https://github.com/a/one' }] },
      { bootstrapCommand: 'ignored', sources: [{ kind: 'git', url: 'https://github.com/a/two' }] },
    ]);

    expect(environment.configuration.sources).toEqual([
      { kind: 'git', path: 'one', url: 'https://github.com/a/one' },
      { kind: 'git', path: 'two', url: 'https://github.com/a/two' },
    ]);
    expect(environment.configuration.bootstrapCommand).toBeUndefined();
  });
});

describe('deleting a project', () => {
  it('releases a built environment as standalone under a name that cannot collide', async () => {
    const project = await insertProject('released', 'Same name');
    const own = await repo.get(project.id);
    // A standalone environment already holds the project-derived name.
    await insertEnvironment('Same name', []);
    const [device] = await db
      .insert(devices)
      .values({
        deviceId: 'released-device',
        identitySource: 'fallback',
        platform: 'linux',
        userId,
      })
      .returning();
    await db.insert(environmentInstances).values({
      configurationSnapshot: {},
      deviceId: device.id,
      environmentId: own.id,
      kind: 'device',
      name: 'built',
      workingDirectory: '/work/released',
    });

    expect(await new ProjectModel(db, userId).delete(project.id)).toMatchObject({ id: project.id });

    const [released] = await db.select().from(environments).where(eq(environments.id, own.id));
    expect(released.projectId).toBeNull();
    expect(released.name).toBe(`Same name (${own.id.slice(0, 8)})`);
  });
});

describe('deleting what owns a project', () => {
  it('deletes an account together with the environments of its projects', async () => {
    const project = await insertProject('doomed');
    await repo.get(project.id);

    await UserModel.deleteUser(db, userId);

    expect(await db.select().from(environments)).toEqual([]);
  });

  it('still refuses while a project environment has something built from it', async () => {
    const project = await insertProject('built');
    const environment = await repo.get(project.id);
    const [device] = await db
      .insert(devices)
      .values({ deviceId: 'built-device', identitySource: 'fallback', platform: 'linux', userId })
      .returning();
    await db.insert(environmentInstances).values({
      configurationSnapshot: {},
      deviceId: device.id,
      environmentId: environment.id,
      kind: 'device',
      name: 'built',
      workingDirectory: '/work/built',
    });

    await expect(UserModel.deleteUser(db, userId)).rejects.toThrow();
  });

  it('deletes a workspace together with the environments of its projects', async () => {
    await db
      .insert(workspaces)
      .values({ id: 'env-ws', name: 'ws', primaryOwnerId: userId, slug: 'env-ws' });
    await db.insert(agents).values({ id: 'ws-agent', userId, workspaceId: 'env-ws' });
    const [project] = await db
      .insert(projects)
      .values({
        coordinatorAgentId: 'ws-agent',
        id: 'ws-project',
        name: 'ws project',
        userId,
        workspaceId: 'env-ws',
      })
      .returning();
    await new ProjectEnvironmentRepository(db, userId, 'env-ws').get(project.id);

    await new WorkspaceDeletionRepository(db, userId).delete('env-ws');

    expect(await db.select().from(workspaces)).toEqual([]);
    expect(await db.select().from(environments)).toEqual([]);
  });
});
