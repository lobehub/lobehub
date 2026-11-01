/**
 * @vitest-environment happy-dom
 *
 * Regression: after a reload the working-sidebar Skills section must paint the
 * last project-skills scan straight away instead of a spinner, while the IPC /
 * RPC scan revalidates in the background.
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
import { useToolStore } from '@/store/tool';
import { initialState as initialToolState } from '@/store/tool/initialState';

import { useProjectSkills } from './useProjectSkills';

vi.mock('@/services/projectSkill', () => ({
  projectSkillService: { listProjectSkills: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

/** Each mount gets a fresh in-memory SWR cache, as after a page reload. */
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

describe('useProjectSkills after a reload', () => {
  const listProjectSkills = () => vi.mocked(projectSkillService.listProjectSkills);

  beforeEach(() => {
    const scope = `use-project-skills-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useToolStore.setState(initialToolState));
    listProjectSkills().mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('paints the cached scan before the fresh scan answers, then replaces it', async () => {
    listProjectSkills().mockResolvedValue(scan('alpha', 'beta'));
    const first = renderHook(() => useProjectSkills('/repo'), { wrapper });
    await waitFor(() =>
      expect(first.result.current.items.map((i) => i.name)).toEqual(['alpha', 'beta']),
    );
    // Let the scan settle into the local copy before the "reload".
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    first.unmount();

    // Reload: in-memory state is gone and the scan is held open.
    act(() => useToolStore.setState(initialToolState));
    let release!: (value: ListProjectSkillsResult) => void;
    listProjectSkills().mockImplementation(
      () => new Promise<ListProjectSkillsResult>((resolve) => (release = resolve)),
    );

    const reloaded = renderHook(() => useProjectSkills('/repo'), { wrapper });

    await waitFor(() =>
      expect(reloaded.result.current.items.map((i) => i.name)).toEqual(['alpha', 'beta']),
    );
    expect(reloaded.result.current.isLoading).toBe(false);

    await act(async () => release(scan('alpha', 'beta', 'gamma')));
    await waitFor(() =>
      expect(reloaded.result.current.items.map((i) => i.name)).toEqual(['alpha', 'beta', 'gamma']),
    );
  });
});
