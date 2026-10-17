import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

import {
  findProjectDirectory,
  PROJECT_TOPICS_POLL_INTERVAL,
  type ProjectDirectory,
  useProjectDirectoryStore,
} from './index';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'scope',
  isScopeTrusted: () => true,
  useCacheScope: () => 'scope',
}));

/** The replica sync call for the project-topics entry. */
const syncCall = () =>
  vi
    .mocked(useClientDataSWR)
    .mock.calls.find(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === 'projectTopics',
    );

const renderTopicList = (projectId = 'project-1') => {
  vi.mocked(useClientDataSWR).mockReturnValue({ isValidating: false, mutate: vi.fn() } as any);
  return renderHook(() => useProjectDirectoryStore.getState().useFetchProjectTopics(projectId));
};

/**
 * Whether the recorded revalidations can match this entry. A scope-wide
 * invalidation matches every key, so only a negative assertion proves a write
 * stayed inside its own entry.
 */
const invalidates = (name: string, entryKey: string) =>
  vi
    .mocked(mutate)
    .mock.calls.some(([match]) =>
      (match as (key: unknown) => boolean)(['replica:sync', name, 1, 'scope', entryKey, undefined]),
    );

describe('projectWorkingDirectory store', () => {
  describe('useFetchProjectTopics polling', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      useProjectDirectoryStore.setState({ projectTopicsMap: {} });
    });

    it('polls while a project conversation is in flight and stops once it settles', () => {
      useProjectDirectoryStore.setState({
        projectTopicsMap: { 'project-1': [{ status: 'running' } as any] },
      });
      const { rerender } = renderTopicList();

      expect(syncCall()?.[2]).toMatchObject({ refreshInterval: PROJECT_TOPICS_POLL_INTERVAL });

      // A settled project never re-reads its whole history on a timer.
      vi.mocked(useClientDataSWR).mockClear();
      useProjectDirectoryStore.setState({
        projectTopicsMap: {
          'project-1': [
            { status: 'active' },
            { status: 'completed' },
            { status: 'unread' },
            { status: null },
          ] as any,
        },
      });
      rerender();

      expect(syncCall()?.[2]).toMatchObject({ refreshInterval: 0 });
    });

    it('treats a conversation waiting for human input as in flight', () => {
      useProjectDirectoryStore.setState({
        projectTopicsMap: { 'project-1': [{ status: 'waitingForHuman' } as any] },
      });
      renderTopicList();

      expect(syncCall()?.[2]).toMatchObject({ refreshInterval: PROJECT_TOPICS_POLL_INTERVAL });
    });

    it('does not poll before anything is loaded', () => {
      renderTopicList();

      expect(syncCall()?.[2]).toMatchObject({ refreshInterval: 0 });
    });
  });

  describe('fetch result', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      useProjectDirectoryStore.setState({ projectTopicsMap: {} });
    });

    it('reports rows only once they have materialized', () => {
      // `isValidating` on its own cannot separate a re-fetch from a first load,
      // so surfaces gating on "nothing to show yet" read `hasData`.
      const { rerender, result } = renderTopicList();
      expect(result.current.hasData).toBe(false);

      // A project with no conversations is loaded, not loading.
      useProjectDirectoryStore.setState({ projectTopicsMap: { 'project-1': [] } });
      rerender();

      expect(result.current.hasData).toBe(true);
    });
  });

  describe('write actions', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('refreshes the projections a bind lands in, and only those entries', async () => {
      vi.spyOn(projectWorkingDirectoryService, 'bind').mockResolvedValue({ data: {} } as never);

      await useProjectDirectoryStore.getState().bind({
        deviceId: 'device-1',
        name: 'repo',
        path: '/repo',
        projectId: 'project-1',
      } as never);

      // The directory, its environment and the conversations it absorbs.
      expect(invalidates('projectDirectories', 'all')).toBe(true);
      expect(invalidates('projectDirectories', 'project-1')).toBe(true);
      expect(invalidates('projectTopics', 'project-1')).toBe(true);
      // One environment is shared across projects, so both scopes converge.
      expect(invalidates('projectEnvironments', 'project-1')).toBe(true);
      expect(invalidates('projectEnvironments', 'all')).toBe(true);
      expect(invalidates('environmentTopics', 'directory-1')).toBe(true);
    });

    it('keeps a project-scoped write inside its own project', async () => {
      vi.spyOn(projectWorkingDirectoryService, 'createProjectTopic').mockResolvedValue({
        data: {},
      } as never);

      await useProjectDirectoryStore.getState().createProjectTopic({
        agentId: 'agent-1',
        projectId: 'project-1',
        title: 'Untitled',
      } as never);

      expect(invalidates('projectTopics', 'project-1')).toBe(true);
      expect(invalidates('projectTopics', 'project-2')).toBe(false);
      expect(invalidates('projectDirectories', 'project-1')).toBe(false);
    });

    it('moves a conversation and refreshes both directories it touched', async () => {
      const moveTopic = vi
        .spyOn(projectWorkingDirectoryService, 'moveTopic')
        .mockResolvedValue({ data: { projectId: 'project-1' } } as never);

      await useProjectDirectoryStore
        .getState()
        .moveTopic({ directoryId: 'directory-2', topicId: 'topic-1' });

      expect(moveTopic).toHaveBeenCalledWith({ directoryId: 'directory-2', topicId: 'topic-1' });
      expect(invalidates('projectTopics', 'project-1')).toBe(true);
      // Left one directory for another: every directory projection is stale.
      expect(invalidates('directoryTopics', 'directory-1')).toBe(true);
      expect(invalidates('directoryTopics', 'directory-2')).toBe(true);
      // The directory rows themselves did not change.
      expect(invalidates('projectDirectories', 'project-1')).toBe(false);
    });
  });
});

describe('findProjectDirectory', () => {
  const stale = { id: 'dir-1', permission: 'read', projectId: 'project-1' } as ProjectDirectory;
  const fresh = { ...stale, permission: 'readWrite' } as ProjectDirectory;

  afterEach(() => {
    useProjectDirectoryStore.setState({
      directoriesMap: {},
      directoriesReplica: { entries: {} } as any,
    });
  });

  const seed = (projections: [key: string, row: ProjectDirectory, updatedAt: number][]) =>
    useProjectDirectoryStore.setState({
      directoriesMap: Object.fromEntries(projections.map(([key, row]) => [key, [row]])),
      directoriesReplica: {
        entries: Object.fromEntries(
          projections.map(([key, , updatedAt]) => [
            key,
            { pending: [], source: 'network', updatedAt },
          ]),
        ),
      } as any,
    });

  // Regression: the lookup returned whichever projection was loaded first, so a
  // stale scope-wide copy could shadow a per-project copy refreshed after a
  // permission change (and the reverse).
  it('returns the most recently confirmed copy regardless of load order', () => {
    seed([
      ['all', stale, 1000],
      ['project-1', fresh, 2000],
    ]);
    expect(findProjectDirectory('dir-1')?.permission).toBe('readWrite');

    seed([
      ['project-1', stale, 1000],
      ['all', fresh, 2000],
    ]);
    expect(findProjectDirectory('dir-1')?.permission).toBe('readWrite');
  });

  // Regression: a newer projection that dropped the row (directory deleted) was
  // skipped, so a stale copy in an older projection still passed the preflight.
  it('treats a newer covering projection that omits the row as authoritative', () => {
    useProjectDirectoryStore.setState({
      directoriesMap: { 'all': [fresh], 'project-1': [] },
      directoriesReplica: {
        entries: {
          'all': { pending: [], source: 'network', updatedAt: 1000 },
          'project-1': { pending: [], source: 'network', updatedAt: 2000 },
        },
      } as any,
    });
    expect(findProjectDirectory('dir-1')).toBeUndefined();
  });

  it('ignores another project projection that would never list the row', () => {
    useProjectDirectoryStore.setState({
      directoriesMap: { 'all': [fresh], 'project-2': [] },
      directoriesReplica: {
        entries: {
          'all': { pending: [], source: 'network', updatedAt: 1000 },
          'project-2': { pending: [], source: 'network', updatedAt: 2000 },
        },
      } as any,
    });
    expect(findProjectDirectory('dir-1')?.permission).toBe('readWrite');
  });

  it('returns undefined when no projection holds the row', () => {
    seed([['all', fresh, 1000]]);
    expect(findProjectDirectory('missing')).toBeUndefined();
  });
});
