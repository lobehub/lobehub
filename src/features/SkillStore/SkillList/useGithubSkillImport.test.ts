import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGithubSkillImport } from './useGithubSkillImport';

const mocks = vi.hoisted(() => ({
  discoverGitHubSkills: vi.fn(),
  importGitHubSkills: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: unknown) => unknown) =>
    selector({ refreshAgentSkills: mocks.refresh }),
}));
vi.mock('@/services/skill', () => ({
  agentSkillService: {
    discoverGitHubSkills: mocks.discoverGitHubSkills,
    importGitHubSkills: mocks.importGitHubSkills,
  },
}));

const commit = 'a'.repeat(40);
const demo = {
  description: 'Demo',
  name: 'demo',
  path: 'skills/demo',
  revision: null,
  status: 'new' as const,
};

const scanned = async () => {
  const hook = renderHook(() => useGithubSkillImport());
  act(() => hook.result.current.setUrl(' https://github.com/lobehub/skills '));
  await act(() => hook.result.current.discover());
  return hook;
};

describe('useGithubSkillImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats a response without candidates as an empty scan', async () => {
    mocks.discoverGitHubSkills.mockResolvedValue({ commit, scope: 'scope' });

    const { result } = await scanned();

    expect(result.current.failure).toBeUndefined();
    expect(result.current.scan).toEqual({ candidates: [], commit, scope: 'scope' });
    expect(result.current.candidates).toEqual([]);
    expect(result.current.selected).toEqual([]);
  });

  it('preselects the only new skill of a scan', async () => {
    mocks.discoverGitHubSkills.mockResolvedValue({ candidates: [demo], commit, scope: 'scope' });

    const { result } = await scanned();

    expect(mocks.discoverGitHubSkills).toHaveBeenCalledWith('https://github.com/lobehub/skills');
    expect(result.current.selected).toEqual(['skills/demo']);
  });

  it('records a failed scan with its raw message as details', async () => {
    mocks.discoverGitHubSkills.mockRejectedValue(new Error('[{"code":"invalid_format"}]'));

    const { result } = await scanned();

    expect(result.current.failure).toEqual({
      details: '[{"code":"invalid_format"}]',
      stage: 'find',
    });
    expect(result.current.scan).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it('pins the scanned commit and scope, and reports a failed batch as an import failure', async () => {
    mocks.discoverGitHubSkills.mockResolvedValue({ candidates: [demo], commit, scope: 'scope' });
    mocks.importGitHubSkills.mockRejectedValue(new Error('The active library changed.'));

    const { result } = await scanned();
    await act(() => result.current.install(['skills/demo']));

    expect(mocks.importGitHubSkills).toHaveBeenCalledWith({
      commit,
      gitUrl: 'https://github.com/lobehub/skills',
      scope: 'scope',
      selections: [{ path: 'skills/demo', revision: null }],
    });
    expect(result.current.failure).toEqual({
      details: 'The active library changed.',
      stage: 'import',
    });
    expect(result.current.results).toEqual([]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('replaces the outcomes of retried paths and refreshes the library', async () => {
    mocks.discoverGitHubSkills.mockResolvedValue({
      candidates: [demo, { ...demo, name: 'other', path: 'skills/other' }],
      commit,
      scope: 'scope',
    });
    mocks.importGitHubSkills
      .mockResolvedValueOnce([
        { path: 'skills/demo', status: 'created' },
        { path: 'skills/other', status: 'failed' },
      ])
      .mockResolvedValueOnce([{ path: 'skills/other', status: 'created' }]);

    const { result } = await scanned();
    await act(() => result.current.install(['skills/demo', 'skills/other']));
    await act(() => result.current.install(['skills/other']));

    expect(result.current.results).toEqual([
      { path: 'skills/demo', status: 'created' },
      { path: 'skills/other', status: 'created' },
    ]);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('drops the scan and the failure when the URL is edited', async () => {
    mocks.discoverGitHubSkills.mockResolvedValue({ candidates: [demo], commit, scope: 'scope' });

    const { result } = await scanned();
    act(() => result.current.setUrl('https://github.com/lobehub/other'));

    expect(result.current.scan).toBeUndefined();
    expect(result.current.failure).toBeUndefined();
  });
});
