/**
 * @vitest-environment happy-dom
 *
 * The project / device skills scan is a replica keyed per device + directory:
 * after a reload the Skills section and the `/` menu paint the persisted scan
 * before the IPC / RPC scan answers, and the fresh scan then replaces it.
 */
import { randomUUID } from 'node:crypto';

import type { ListProjectSkillsResult, ProjectSkillItem } from '@lobechat/electron-client-ipc';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { projectSkillService } from '@/services/projectSkill';

import { useToolStore } from '../../store';
import { initialProjectSkillsState } from './initialState';
import { type ProjectSkillsParams, projectSkillsResource } from './projection';
import { projectSkillsSelectors } from './selectors';

vi.mock('@/services/projectSkill', () => ({
  projectSkillService: { listProjectSkills: vi.fn() },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

/** A fresh SWR cache per mount, like a reload: nothing survives but storage. */
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const skill = (name: string): ProjectSkillItem => ({
  fileCount: 1,
  files: ['SKILL.md'],
  name,
  path: `/repo/.agents/skills/${name}/SKILL.md`,
  previewRoot: '/repo',
  scope: 'project',
  skillDir: `/repo/.agents/skills/${name}`,
  source: 'agents',
});

const scan = (...names: string[]): ListProjectSkillsResult => ({
  root: '/repo',
  skills: names.map(skill),
  source: 'agents',
});

/** Never-resolving scan: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const LOCAL_REPO: ProjectSkillsParams = { workingDirectory: '/repo' };
const DEVICE_REPO: ProjectSkillsParams = { deviceId: 'device-1', workingDirectory: '/repo' };
const LOCAL_OTHER: ProjectSkillsParams = { workingDirectory: '/other' };
const ALL_PARAMS = [LOCAL_REPO, DEVICE_REPO, LOCAL_OTHER];

describe('projectSkills replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  const listProjectSkills = () => vi.mocked(projectSkillService.listProjectSkills);
  const rowKey = (params: ProjectSkillsParams) => projectSkillsResource.storageKey(params);
  const persist = (params: ProjectSkillsParams, data: ListProjectSkillsResult) =>
    projectSkillsResource.storage!.set({ queryKey: rowKey(params), scope }, { data, updatedAt: 1 });
  const fetchSkills = ({ deviceId, workingDirectory }: ProjectSkillsParams) =>
    renderHook(() => useToolStore((s) => s.useFetchProjectSkills)(workingDirectory, deviceId), {
      wrapper,
    });
  const skillNames = ({ deviceId, workingDirectory }: ProjectSkillsParams) =>
    projectSkillsSelectors
      .getProjectSkills(
        workingDirectory,
        deviceId,
      )(useToolStore.getState())
      ?.skills.map((s) => s.name);
  /** A reload: the in-memory store is gone, only the persisted rows remain. */
  const reload = () => act(() => useToolStore.setState(initialProjectSkillsState));

  beforeEach(() => {
    useScope(`project-skills-user-${randomUUID()}:personal`);
    reload();
    listProjectSkills().mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        ALL_PARAMS.map((params) =>
          projectSkillsResource.storage!.remove({ queryKey: rowKey(params), scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the last scan after a reload before the scan answers, then replaces it', async () => {
    listProjectSkills().mockResolvedValue(scan('alpha', 'beta'));
    const first = fetchSkills(LOCAL_REPO);
    await waitFor(() => expect(skillNames(LOCAL_REPO)).toEqual(['alpha', 'beta']));
    // Wait for the scan to land in storage before "reloading".
    await waitFor(async () =>
      expect(
        (await projectSkillsResource.storage!.get({ queryKey: rowKey(LOCAL_REPO), scope }))?.data,
      ).toEqual(scan('alpha', 'beta')),
    );
    first.unmount();

    reload();
    expect(skillNames(LOCAL_REPO)).toBeUndefined();

    let release!: (value: ListProjectSkillsResult) => void;
    listProjectSkills().mockImplementation(
      () => new Promise<ListProjectSkillsResult>((resolve) => (release = resolve)),
    );
    const sync = fetchSkills(LOCAL_REPO);

    // The persisted scan paints while the IPC scan is still held open.
    await waitFor(() => expect(skillNames(LOCAL_REPO)).toEqual(['alpha', 'beta']));
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);

    await act(async () => release(scan('alpha', 'beta', 'gamma')));
    await waitFor(() => expect(skillNames(LOCAL_REPO)).toEqual(['alpha', 'beta', 'gamma']));
  });

  it('scans through the device RPC or local IPC for the requested directory', async () => {
    listProjectSkills().mockResolvedValue(scan('alpha'));

    fetchSkills(DEVICE_REPO);
    await waitFor(() =>
      expect(listProjectSkills()).toHaveBeenCalledWith({ deviceId: 'device-1', scope: '/repo' }),
    );

    fetchSkills(LOCAL_REPO);
    await waitFor(() =>
      expect(listProjectSkills()).toHaveBeenCalledWith({ deviceId: undefined, scope: '/repo' }),
    );
  });

  it('keeps each device + directory in its own entry', async () => {
    await persist(LOCAL_REPO, scan('local-repo'));
    await persist(DEVICE_REPO, scan('device-repo'));
    await persist(LOCAL_OTHER, scan('local-other'));
    listProjectSkills().mockImplementation(pending);

    fetchSkills(DEVICE_REPO);
    await waitFor(() => expect(skillNames(DEVICE_REPO)).toEqual(['device-repo']));
    expect(skillNames(LOCAL_REPO)).toBeUndefined();

    fetchSkills(LOCAL_OTHER);
    await waitFor(() => expect(skillNames(LOCAL_OTHER)).toEqual(['local-other']));
    expect(skillNames(LOCAL_REPO)).toBeUndefined();
  });

  it('does not paint another user scope’s persisted scan', async () => {
    await persist(LOCAL_REPO, scan('someone-else'));
    useScope(`project-skills-user-${randomUUID()}:personal`);
    listProjectSkills().mockImplementation(pending);

    const sync = fetchSkills(LOCAL_REPO);
    await waitFor(() => expect(sync.result.current.isHydrated).toBe(true));
    expect(skillNames(LOCAL_REPO)).toBeUndefined();
  });

  it('settles a host without a scanner to an empty scan', async () => {
    listProjectSkills().mockResolvedValue(undefined);

    fetchSkills(LOCAL_REPO);
    await waitFor(() => expect(skillNames(LOCAL_REPO)).toEqual([]));
  });

  it('stays inert without a working directory', async () => {
    const sync = fetchSkills({ workingDirectory: '' });

    await waitFor(() => expect(sync.result.current.isValidating).toBe(false));
    expect(listProjectSkills()).not.toHaveBeenCalled();
  });
});
