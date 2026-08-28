import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectService } from '@/services/project';

import type { ProjectDetail, ProjectListItem } from './store';
import { useCurrentProjectDetail, useCurrentProjectList, useProjectStore } from './store';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  swrConfigs: [] as Array<{ onSuccess: (response: unknown) => void }>,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => mocks.activeWorkspaceId,
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(
    (_key: unknown, _fetcher: unknown, config: { onSuccess: (response: unknown) => void }) => {
      mocks.swrConfigs.push(config);
      return {};
    },
  ),
}));

describe('project store workspace scope', () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = null;
    mocks.swrConfigs = [];
    useProjectStore.setState({ projectDetails: {}, projectLists: {} });
  });

  it('keeps project lists isolated between personal and workspace contexts', () => {
    const personalProject = { id: 'personal-project' } as ProjectListItem;
    const workspaceProject = { id: 'workspace-project' } as ProjectListItem;
    const { rerender } = renderHook(() => useProjectStore.getState().useFetchProjectList());

    act(() => mocks.swrConfigs.at(-1)?.onSuccess({ data: [personalProject], success: true }));
    mocks.activeWorkspaceId = 'workspace-1';
    rerender();
    act(() => mocks.swrConfigs.at(-1)?.onSuccess({ data: [workspaceProject], success: true }));

    expect(renderHook(() => useCurrentProjectList()).result.current).toEqual([workspaceProject]);

    mocks.activeWorkspaceId = null;
    expect(renderHook(() => useCurrentProjectList()).result.current).toEqual([personalProject]);
  });

  it('keeps project details isolated between personal and workspace contexts', () => {
    const personalDetail = { project: { id: 'shared-id', name: 'Personal' } } as ProjectDetail;
    const workspaceDetail = { project: { id: 'shared-id', name: 'Workspace' } } as ProjectDetail;
    const { rerender } = renderHook(() =>
      useProjectStore.getState().useFetchProjectDetail('shared-id'),
    );

    act(() => mocks.swrConfigs.at(-1)?.onSuccess({ data: personalDetail, success: true }));
    mocks.activeWorkspaceId = 'workspace-1';
    rerender();
    act(() => mocks.swrConfigs.at(-1)?.onSuccess({ data: workspaceDetail, success: true }));

    expect(renderHook(() => useCurrentProjectDetail('shared-id')).result.current).toBe(
      workspaceDetail,
    );
    mocks.activeWorkspaceId = null;
    expect(renderHook(() => useCurrentProjectDetail('shared-id')).result.current).toBe(
      personalDetail,
    );
  });

  it('pins project creation to the active workspace', async () => {
    mocks.activeWorkspaceId = 'workspace-1';
    const project = { id: 'project-1', slug: 'launch' } as ProjectListItem;
    vi.spyOn(projectService, 'create').mockResolvedValue({
      data: project,
      message: 'Project created',
      success: true,
    });

    await expect(
      useProjectStore
        .getState()
        .createProject({ identifier: 'LOB', name: 'Launch', slug: 'launch' }),
    ).resolves.toBe(project);

    expect(projectService.create).toHaveBeenCalledWith(
      { identifier: 'LOB', name: 'Launch', slug: 'launch' },
      'workspace-1',
    );
  });

  it('refreshes the project list after deletion', async () => {
    const refreshProjectList = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(projectService, 'delete').mockResolvedValue({
      data: { id: 'project-1' } as ProjectListItem,
      message: 'Project deleted',
      success: true,
    });
    useProjectStore.setState({ refreshProjectList });

    await useProjectStore.getState().deleteProject('project-1');

    expect(projectService.delete).toHaveBeenCalledWith('project-1');
    expect(refreshProjectList).toHaveBeenCalledOnce();
  });

  it('updates project list and detail caches after renaming', async () => {
    const project = { id: 'project-1', name: 'Original', slug: 'launch' } as ProjectListItem;
    const renamed = { ...project, name: 'Renamed' };
    const detail = { project } as ProjectDetail;
    const refreshProjectList = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(projectService, 'update').mockResolvedValue({
      data: renamed,
      message: 'Project updated',
      success: true,
    });
    useProjectStore.setState({
      projectDetails: { personal: { launch: detail } },
      projectLists: { personal: [project] },
      refreshProjectList,
    });

    await useProjectStore.getState().updateProject('project-1', { name: 'Renamed' });

    expect(useProjectStore.getState().projectLists.personal[0].name).toBe('Renamed');
    expect(useProjectStore.getState().projectDetails.personal.launch.project.name).toBe('Renamed');
    expect(refreshProjectList).toHaveBeenCalledOnce();
  });
});
