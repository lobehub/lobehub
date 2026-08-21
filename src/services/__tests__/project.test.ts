import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceLambdaClient, lambdaClient } from '@/libs/trpc/client';
import { projectService } from '@/services/project';

vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: vi.fn(),
  lambdaClient: {
    project: {
      bindDirectory: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      findProjectByWorkingDirectory: { query: vi.fn() },
      list: { query: vi.fn() },
      listDirectories: { query: vi.fn() },
      unbindDirectory: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
    },
  },
}));

describe('ProjectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads every project page', async () => {
    type ProjectRows = Awaited<ReturnType<typeof lambdaClient.project.list.query>>['data'];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `project-${index}`,
    })) as ProjectRows;
    const secondPage = [{ id: 'project-100' }] as ProjectRows;
    vi.mocked(lambdaClient.project.list.query)
      .mockResolvedValueOnce({ data: firstPage, success: true })
      .mockResolvedValueOnce({ data: secondPage, success: true });

    const response = await projectService.listAll();

    expect(response.data).toHaveLength(101);
    expect(lambdaClient.project.list.query).toHaveBeenNthCalledWith(1, {
      limit: 100,
      offset: 0,
    });
    expect(lambdaClient.project.list.query).toHaveBeenNthCalledWith(2, {
      limit: 100,
      offset: 100,
    });
  });

  it('uses a workspace-pinned client when creating in a workspace', async () => {
    const mutate = vi.fn().mockResolvedValue({ data: { id: 'project-1' }, success: true });
    vi.mocked(createWorkspaceLambdaClient).mockReturnValue({
      project: { create: { mutate } },
    } as unknown as ReturnType<typeof createWorkspaceLambdaClient>);

    await projectService.create(
      { identifier: 'LOB', name: 'Launch', slug: 'launch' },
      'workspace-1',
    );

    expect(createWorkspaceLambdaClient).toHaveBeenCalledWith('workspace-1');
    expect(mutate).toHaveBeenCalledWith({ identifier: 'LOB', name: 'Launch', slug: 'launch' });
    expect(lambdaClient.project.create.mutate).not.toHaveBeenCalled();
  });

  it('forwards directory bindings when creating a project from a folder', async () => {
    const mutate = vi.fn().mockResolvedValue({ data: { id: 'project-1' }, success: true });
    vi.mocked(lambdaClient.project.create.mutate).mockReturnValue(mutate());

    await projectService.create({
      identifier: 'APP',
      name: 'App',
      bindings: [{ environmentType: 'device', workingDirectory: '/Users/me/code/app' }],
    });

    expect(lambdaClient.project.create.mutate).toHaveBeenCalledWith({
      identifier: 'APP',
      name: 'App',
      bindings: [{ environmentType: 'device', workingDirectory: '/Users/me/code/app' }],
    });
  });

  it('deletes a project by its internal id', async () => {
    vi.mocked(lambdaClient.project.delete.mutate).mockResolvedValue({
      data: { id: 'project-1' },
      message: 'Project deleted',
      success: true,
    } as Awaited<ReturnType<typeof lambdaClient.project.delete.mutate>>);

    await projectService.delete('project-1');

    expect(lambdaClient.project.delete.mutate).toHaveBeenCalledWith({ id: 'project-1' });
  });

  it('updates a project name by its internal id', async () => {
    vi.mocked(lambdaClient.project.update.mutate).mockResolvedValue({
      data: { id: 'project-1', name: 'Renamed' },
      message: 'Project updated',
      success: true,
    } as Awaited<ReturnType<typeof lambdaClient.project.update.mutate>>);

    await projectService.update('project-1', { name: 'Renamed' });

    expect(lambdaClient.project.update.mutate).toHaveBeenCalledWith({
      id: 'project-1',
      name: 'Renamed',
    });
  });

  it('resolves the project bound to a working directory by path alone', async () => {
    vi.mocked(lambdaClient.project.findProjectByWorkingDirectory.query).mockResolvedValue({
      data: { id: 'project-1', name: 'App' },
      success: true,
    } as Awaited<ReturnType<typeof lambdaClient.project.findProjectByWorkingDirectory.query>>);

    await expect(
      projectService.findProjectByWorkingDirectory('/Users/me/code/app'),
    ).resolves.toEqual({
      data: { id: 'project-1', name: 'App' },
      success: true,
    });

    expect(lambdaClient.project.findProjectByWorkingDirectory.query).toHaveBeenCalledWith({
      workingDirectory: '/Users/me/code/app',
    });
  });

  it('binds a directory to a project', async () => {
    const mutate = vi.fn().mockResolvedValue({ data: { id: 'binding-1' }, success: true });
    vi.mocked(lambdaClient.project.bindDirectory.mutate).mockReturnValue(mutate());

    await projectService.bindDirectory('project-1', {
      environmentType: 'device',
      workingDirectory: '/Users/me/code/app',
    });

    expect(lambdaClient.project.bindDirectory.mutate).toHaveBeenCalledWith({
      id: 'project-1',
      environmentType: 'device',
      workingDirectory: '/Users/me/code/app',
    });
  });

  it('lists and unbinds a project directory binding', async () => {
    vi.mocked(lambdaClient.project.listDirectories.query).mockResolvedValue({
      data: [{ id: 'binding-1', workingDirectory: '/Users/me/code/app' }],
      success: true,
    } as Awaited<ReturnType<typeof lambdaClient.project.listDirectories.query>>);
    vi.mocked(lambdaClient.project.unbindDirectory.mutate).mockResolvedValue({
      data: { id: 'binding-1' },
      success: true,
    } as Awaited<ReturnType<typeof lambdaClient.project.unbindDirectory.mutate>>);

    await expect(projectService.listDirectories('project-1')).resolves.toEqual({
      data: [{ id: 'binding-1', workingDirectory: '/Users/me/code/app' }],
      success: true,
    });
    await expect(projectService.unbindDirectory('binding-1')).resolves.toEqual({
      data: { id: 'binding-1' },
      success: true,
    });

    expect(lambdaClient.project.unbindDirectory.mutate).toHaveBeenCalledWith({
      bindingId: 'binding-1',
    });
  });
});
