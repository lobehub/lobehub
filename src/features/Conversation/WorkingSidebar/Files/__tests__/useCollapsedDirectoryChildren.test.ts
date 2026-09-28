import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectFileService } from '@/services/projectFile';

import {
  selectCollapsedChildren,
  useCollapsedDirectoryChildren,
} from '../useCollapsedDirectoryChildren';

vi.mock('@/services/projectFile', () => ({
  projectFileService: { listProjectDirectory: vi.fn() },
}));

const ROOT = '/repo';

const dir = (relativePath: string, collapsed = false): ProjectFileIndexEntry => ({
  collapsed: collapsed || undefined,
  isDirectory: true,
  name: relativePath.replace(/\/$/, '').split('/').pop()!,
  path: `${ROOT}/${relativePath.replace(/\/$/, '')}`,
  relativePath,
});

const file = (relativePath: string): ProjectFileIndexEntry => ({
  isDirectory: false,
  name: relativePath.split('/').pop()!,
  path: `${ROOT}/${relativePath}`,
  relativePath,
});

const listDirectory = vi.mocked(projectFileService.listProjectDirectory);

describe('selectCollapsedChildren', () => {
  it('keeps children of collapsed directories, including nested listed ones', () => {
    const entries = [dir('node_modules/', true)];
    const children = [dir('node_modules/pkg/', true), file('node_modules/pkg/index.js')];

    expect(selectCollapsedChildren(entries, children)).toEqual(children);
  });

  it('drops children the index already lists or whose parent is no longer collapsed', () => {
    const entries = [dir('src/'), dir('src/hooks/'), file('src/hooks/index.ts')];
    const children = [file('src/hooks/index.ts'), file('src/hooks/stale.ts')];

    expect(selectCollapsedChildren(entries, children)).toEqual([]);
  });
});

describe('useCollapsedDirectoryChildren', () => {
  beforeEach(() => {
    listDirectory.mockReset();
  });

  it('does not duplicate a file pasted into a new empty folder once the index lists it', async () => {
    // A new empty folder is indexed as collapsed, so expanding it lists it on demand.
    listDirectory.mockResolvedValueOnce({ entries: [], truncated: false } as any);
    const { result, rerender } = renderHook(
      ({ entries }) =>
        useCollapsedDirectoryChildren({
          entries,
          expandedIds: ['src/', 'src/hooks/'],
          projectRoot: ROOT,
        }),
      { initialProps: { entries: [dir('src/'), dir('src/hooks/', true)] } },
    );
    await waitFor(() => expect(listDirectory).toHaveBeenCalledTimes(1));

    // Paste writes src/hooks/index.ts: the listing is re-read, and the refreshed
    // index now lists the folder (no longer collapsed) together with the file.
    listDirectory.mockResolvedValueOnce({
      entries: [file('src/hooks/index.ts')],
      truncated: false,
    } as any);
    act(() => result.current.invalidate());
    await waitFor(() => expect(listDirectory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.children).toHaveLength(1));

    rerender({ entries: [dir('src/'), dir('src/hooks/'), file('src/hooks/index.ts')] });

    expect(result.current.children).toEqual([]);
  });
});
