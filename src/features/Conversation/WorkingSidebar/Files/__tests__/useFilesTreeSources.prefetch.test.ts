import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  git: [] as unknown[][],
  project: [] as unknown[][],
}));

vi.mock('../useProjectFiles', () => ({
  useProjectFiles: (...args: unknown[]) => {
    calls.project.push(args);
    return { data: undefined };
  },
}));

vi.mock('../useGitWorkingTreeFiles', () => ({
  useGitWorkingTreeFiles: (...args: unknown[]) => {
    calls.git.push(args);
    return { data: undefined };
  },
}));

const { useFilesTreeSources } = await import('../useFilesTreeSources');

beforeEach(() => {
  calls.git.length = 0;
  calls.project.length = 0;
});

describe('useFilesTreeSources — prefetch mode', () => {
  it('disables focus revalidation for a hidden prefetch', () => {
    renderHook(() => useFilesTreeSources('device-1', '/repo', { instanceId: 'i', live: false }));

    expect(calls.project[0][2]).toMatchObject({ live: false });
    expect(calls.git[0][3]).toEqual({ revalidateOnFocus: false });
  });

  it('keeps focus revalidation for the visible pane', () => {
    renderHook(() => useFilesTreeSources('device-1', '/repo', { instanceId: 'i' }));

    expect(calls.git[0][3]).toEqual({ revalidateOnFocus: true });
  });
});
