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

  it.each([
    ['PRECONDITION_FAILED', 'connect'],
    ['NOT_FOUND', 'access'],
  ])('keeps the source URL and exposes recovery for %s', async (code, recovery) => {
    mocks.discoverGitHubSkills.mockRejectedValueOnce(
      Object.assign(new Error('GitHub access failed'), { data: { code } }),
    );
    const { result } = await scanned();
    expect(result.current.failure).toEqual({ recovery, stage: 'find' });
    expect(result.current.url.trim()).toBe('https://github.com/lobehub/skills');
  });

  it('offers repository access guidance for the unclassified error from older servers', async () => {
    const details = 'GitHub repository or ref not found';
    mocks.discoverGitHubSkills.mockRejectedValueOnce(
      Object.assign(new Error(details), { data: { code: 'INTERNAL_SERVER_ERROR' } }),
    );
    const { result } = await scanned();
    expect(result.current.failure).toEqual({ recovery: 'access', stage: 'find' });
  });

  it('rescans the original link after connecting without installing a skill', async () => {
    mocks.discoverGitHubSkills
      .mockRejectedValueOnce(
        Object.assign(new Error('Connect GitHub'), { data: { code: 'PRECONDITION_FAILED' } }),
      )
      .mockResolvedValueOnce({ candidates: [demo], commit, scope: 'scope' });
    const { result } = await scanned();

    await act(() => result.current.resumeAfterConnect());

    expect(mocks.discoverGitHubSkills.mock.calls).toEqual([
      ['https://github.com/lobehub/skills'],
      ['https://github.com/lobehub/skills'],
    ]);
    expect(result.current.selected).toEqual([demo.path]);
    expect(result.current.failure).toBeUndefined();
    expect(mocks.importGitHubSkills).not.toHaveBeenCalled();
  });

  it('keeps the pinned preview and selection when reconnecting after a batch error', async () => {
    mocks.discoverGitHubSkills.mockResolvedValueOnce({
      candidates: [demo],
      commit,
      scope: 'scope',
    });
    mocks.importGitHubSkills.mockRejectedValueOnce(
      Object.assign(new Error('Connect GitHub'), { data: { code: 'PRECONDITION_FAILED' } }),
    );
    const { result } = await scanned();
    await act(() => result.current.install([demo.path]));

    expect(result.current.failure).toEqual({ recovery: 'connect', stage: 'import' });
    await act(() => result.current.resumeAfterConnect());

    expect(result.current.scan?.commit).toBe(commit);
    expect(result.current.selected).toEqual([demo.path]);
    expect(result.current.failure).toBeUndefined();
    expect(mocks.importGitHubSkills).toHaveBeenCalledTimes(1);
    expect(mocks.discoverGitHubSkills).toHaveBeenCalledTimes(1);
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

  it('keeps completed imports when refreshing the library fails and retries only the refresh', async () => {
    mocks.discoverGitHubSkills.mockResolvedValue({ candidates: [demo], commit, scope: 'scope' });
    mocks.importGitHubSkills.mockResolvedValue([{ path: demo.path, status: 'created' }]);
    mocks.refresh.mockRejectedValueOnce(new Error('Offline'));

    const { result } = await scanned();
    await act(() => result.current.install([demo.path]));
    expect(result.current.failure).toEqual({ details: 'Offline', stage: 'refresh' });
    expect(result.current.results).toEqual([{ path: demo.path, status: 'created' }]);

    await act(() => result.current.refreshLibrary());
    expect(result.current.failure).toBeUndefined();
    expect(mocks.importGitHubSkills).toHaveBeenCalledTimes(1);
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
