import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProjectRepository } from '../../repositories/project';
import { environments, projectEnvironments, users, workspaces } from '../../schemas';
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

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }]);
  });

  afterEach(async () => {
    await serverDB.delete(projectEnvironments);
    await serverDB.delete(environments);
    await serverDB.delete(workspaces);
    await serverDB.delete(users);
  });

  it('creates a project from a GitHub repository with its environment attached', async () => {
    const project = await createProject(repo, {
      name: 'lobehub',
      repository: {
        defaultBranch: 'canary',
        name: 'lobehub/lobehub',
        url: 'https://github.com/lobehub/lobehub.git',
      },
    });

    expect(await model.listEnvironments(project.id)).toEqual([
      expect.objectContaining({
        configuration: expect.objectContaining({
          kind: 'code',
          sources: [{ kind: 'git', ref: 'canary', url: 'https://github.com/lobehub/lobehub' }],
        }),
        name: 'lobehub/lobehub',
      }),
    ]);

    // A second project on the same repository shares the definition.
    const second = await createProject(repo, {
      name: 'lobehub again',
      repository: { name: 'lobehub/lobehub', url: 'git@github.com:lobehub/lobehub.git' },
    });
    const [first] = await model.listEnvironments(project.id);
    expect(await model.listEnvironments(second.id)).toEqual([
      expect.objectContaining({ id: first.id }),
    ]);
  });

  it('publishes the repository of a shared workspace project instead of reusing a private one', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Repository Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const repository = { name: 'lobehub/lobehub', url: 'https://github.com/lobehub/lobehub' };
    // The creator already checks the repository out privately.
    const own = await new EnvironmentModel(serverDB, userId, workspaceId).ensureForRepository({
      name: repository.name,
      repositoryUrl: repository.url,
    });
    const workspaceRepo = new ProjectRepository(serverDB, userId, workspaceId);
    const workspaceModel = new ProjectModel(serverDB, userId, workspaceId);

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

    const [sharedEnvironment] = await workspaceModel.listEnvironments(shared.id);
    expect(sharedEnvironment).toEqual(expect.objectContaining({ visibility: 'public' }));
    expect(sharedEnvironment.id).not.toBe(own.id);
    expect(await workspaceModel.listEnvironments(privateProject.id)).toEqual([
      expect.objectContaining({ id: own.id, visibility: 'private' }),
    ]);
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
