import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProjectRepository } from '../../repositories/project';
import { ProjectEnvironmentRepository } from '../../repositories/projectEnvironment';
import { environments, projectEnvironments, projects, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { EnvironmentModel } from '../environment';
import type { CreateProjectInput } from '../project';
import { ProjectModel } from '../project';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'project-repository-user';
const workspaceId = 'project-repository-workspace';
let projectIdentifierSequence = 0;

// Creating a project spans the project and the environment aggregates, so the
// environment rides on `ProjectRepository.create`'s transaction rather than on
// the single-table model insert.
const createProject = (repo: ProjectRepository, input: Omit<CreateProjectInput, 'identifier'>) =>
  repo.create({
    ...input,
    identifier: `R${String(++projectIdentifierSequence).padStart(5, '0')}`,
  });

describe('a project created from a GitHub repository', () => {
  const repo = new ProjectRepository(serverDB, userId);
  const model = new ProjectModel(serverDB, userId);

  // Only this file's own rows: other test files share the database and run at
  // the same time, and their environments hold their users back.
  const cleanup = async () => {
    const own = serverDB
      .select({ id: environments.id })
      .from(environments)
      .where(eq(environments.userId, userId));
    await serverDB
      .delete(projectEnvironments)
      .where(inArray(projectEnvironments.environmentId, own));
    await serverDB.delete(environments).where(eq(environments.userId, userId));
    await serverDB.delete(projects).where(eq(projects.userId, userId));
    await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await serverDB.delete(users).where(eq(users.id, userId));
  };

  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }]);
  });

  afterEach(cleanup);

  const environmentOf = (database: typeof serverDB, projectId: string, workspace?: string) =>
    new ProjectEnvironmentRepository(database, userId, workspace).get(projectId);

  it('creates a project from a GitHub repository with its own environment checking it out', async () => {
    const project = await createProject(repo, {
      name: 'lobehub',
      repository: {
        defaultBranch: 'canary',
        name: 'lobehub/lobehub',
        url: 'https://github.com/lobehub/lobehub.git',
      },
    });

    const environment = await environmentOf(serverDB, project.id);
    expect(environment).toEqual(
      expect.objectContaining({
        configuration: expect.objectContaining({
          kind: 'code',
          sources: [{ kind: 'git', ref: 'canary', url: 'https://github.com/lobehub/lobehub' }],
        }),
        name: 'lobehub',
        projectId: project.id,
      }),
    );

    // A second project on the same repository gets an environment of its own.
    const second = await createProject(repo, {
      name: 'lobehub again',
      repository: { name: 'lobehub/lobehub', url: 'git@github.com:lobehub/lobehub.git' },
    });
    const secondEnvironment = await environmentOf(serverDB, second.id);
    expect(secondEnvironment.id).not.toBe(environment.id);
    expect(secondEnvironment.projectId).toBe(second.id);
  });

  it('checks out more repositories beside the main one, side by side', async () => {
    const project = await createProject(repo, {
      additionalRepositories: [
        { url: 'https://github.com/lobehub/lobe-ui' },
        // The main one again is not checked out twice.
        { url: 'git@github.com:lobehub/lobehub.git' },
        { defaultBranch: 'main', url: 'https://github.com/lobehub/lobe-icons.git' },
      ],
      name: 'Monorepo and friends',
      repository: {
        defaultBranch: 'canary',
        name: 'lobehub/lobehub',
        url: 'https://github.com/lobehub/lobehub',
      },
    });

    expect((await environmentOf(serverDB, project.id)).configuration.sources).toEqual([
      { kind: 'git', path: 'lobehub', ref: 'canary', url: 'https://github.com/lobehub/lobehub' },
      { kind: 'git', path: 'lobe-ui', url: 'https://github.com/lobehub/lobe-ui' },
      {
        kind: 'git',
        path: 'lobe-icons',
        ref: 'main',
        url: 'https://github.com/lobehub/lobe-icons',
      },
    ]);
  });

  it('creates an empty environment for a project made without a repository', async () => {
    const project = await createProject(repo, { name: 'Notes' });

    const links = await serverDB
      .select()
      .from(projectEnvironments)
      .where(eq(projectEnvironments.projectId, project.id));
    const environment = await environmentOf(serverDB, project.id);
    expect(links).toEqual([
      expect.objectContaining({ environmentId: environment.id, enabled: true, isDefault: true }),
    ]);
    expect(environment.configuration.sources ?? []).toEqual([]);
    // Two projects of the same name do not collide on the environment name.
    const again = await createProject(repo, { name: 'Notes', slug: 'notes-2' });
    expect((await environmentOf(serverDB, again.id)).name).toBe('Notes');
  });

  it('publishes the environment of a shared workspace project and keeps a private one private', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Repository Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const repository = { name: 'lobehub/lobehub', url: 'https://github.com/lobehub/lobehub' };
    const workspaceRepo = new ProjectRepository(serverDB, userId, workspaceId);

    const shared = await createProject(workspaceRepo, {
      name: 'Shared',
      repository,
      visibility: 'public',
    });
    const privateProject = await createProject(workspaceRepo, {
      name: 'Private',
      repository,
      visibility: 'private',
    });

    expect(await environmentOf(serverDB, shared.id, workspaceId)).toEqual(
      expect.objectContaining({ visibility: 'public' }),
    );
    expect(await environmentOf(serverDB, privateProject.id, workspaceId)).toEqual(
      expect.objectContaining({ visibility: 'private' }),
    );
    // Neither shows up among the standalone environments of「设置 → 环境」.
    expect(await new EnvironmentModel(serverDB, userId, workspaceId).query()).toEqual([]);
  });

  it('removes an unbuilt environment with its project', async () => {
    const project = await createProject(repo, { name: 'Short lived' });
    await environmentOf(serverDB, project.id);

    await repo.delete(project.id);

    expect(await serverDB.select().from(environments)).toEqual([]);
  });

  it('names the unique index a taken slug violates, so the router can map it', async () => {
    await createProject(repo, { name: 'Taken', slug: 'taken' });
    const error = await createProject(repo, { name: 'Taken again', slug: 'taken' }).catch(
      (e: unknown) => e,
    );
    let cause: any = error;
    while (cause && !cause.constraint) cause = cause.cause;
    expect(cause).toMatchObject({ code: '23505', constraint: 'projects_slug_user_id_unique' });
  });

  it('creates nothing when the repository URL is not a GitHub repository', async () => {
    await expect(
      createProject(repo, {
        name: 'Broken',
        repository: { name: 'broken', url: 'https://example.com/a/b' },
      }),
    ).rejects.toThrow('GitHub');
    expect(await model.list()).toEqual([]);
    expect(await serverDB.select().from(environments)).toEqual([]);
  });
});
