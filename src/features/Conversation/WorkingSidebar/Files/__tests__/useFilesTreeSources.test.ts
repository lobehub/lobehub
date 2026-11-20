import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFilesTreeSources } from '../useFilesTreeSources';

const services = vi.hoisted(() => ({
  getGitWorkingTreeFiles: vi.fn(),
  getProjectFileIndex: vi.fn(),
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: { getProjectFileIndex: services.getProjectFileIndex },
}));
vi.mock('@/services/git', () => ({
  gitService: { getGitWorkingTreeFiles: services.getGitWorkingTreeFiles },
}));
vi.mock('@/store/chat', () => ({ useChatStore: () => false }));
vi.mock('@/store/chat/selectors', () => ({ operationSelectors: {} }));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  services.getGitWorkingTreeFiles.mockReset();
  services.getProjectFileIndex.mockReset();
});

describe('useFilesTreeSources', () => {
  it('reads the git overlay alongside the index instead of after it', async () => {
    const index = deferred<unknown>();
    services.getProjectFileIndex.mockReturnValue(index.promise);
    services.getGitWorkingTreeFiles.mockResolvedValue({
      added: [],
      deleted: [],
      modified: ['a.ts'],
    });

    const { result } = renderHook(() => useFilesTreeSources('device-1', '/repo'), { wrapper });

    // The index is still in flight, yet the overlay has already been asked for.
    await waitFor(() => expect(result.current.git.data?.modified).toEqual(['a.ts']));
    expect(services.getGitWorkingTreeFiles).toHaveBeenCalledWith({
      deviceId: 'device-1',
      path: '/repo',
    });
    expect(result.current.project.data).toBeUndefined();

    await act(async () => {
      index.resolve({ entries: [], indexedAt: 'now', root: '/repo', source: 'git' });
    });
    expect(result.current.project.data?.source).toBe('git');
    expect(result.current.git.data?.modified).toEqual(['a.ts']);
  });

  it('drops the overlay once the index settles on a non-git source', async () => {
    services.getProjectFileIndex.mockResolvedValue({
      entries: [],
      indexedAt: 'now',
      root: '/plain',
      source: 'glob',
    });
    services.getGitWorkingTreeFiles.mockResolvedValue({ added: [], deleted: [], modified: [] });

    const { result } = renderHook(() => useFilesTreeSources('device-1', '/plain'), { wrapper });

    await waitFor(() => expect(result.current.project.data?.source).toBe('glob'));
    expect(result.current.git.data).toBeUndefined();
  });

  it('never asks a sandbox tree for git status', async () => {
    services.getProjectFileIndex.mockResolvedValue({
      entries: [],
      indexedAt: 'now',
      root: '',
      source: 'sandbox',
    });

    const { result } = renderHook(
      () => useFilesTreeSources(undefined, '', { instanceId: 'instance-1' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.project.data?.source).toBe('sandbox'));
    expect(services.getGitWorkingTreeFiles).not.toHaveBeenCalled();
  });
});
