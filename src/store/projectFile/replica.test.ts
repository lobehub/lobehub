/**
 * The Files tab tree and its git overlay are replicas: a reload paints the
 * last tree of a host + directory from storage, then the host is asked again.
 * Each test "reloads" by re-importing every module (a fresh store, engine and
 * SWR cache) over the same IndexedDB.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  getGitWorkingTreeFiles: vi.fn(),
  getProjectFileIndex: vi.fn(),
}));
const scope = vi.hoisted(() => ({ current: 'u1:personal' }));

vi.mock('@/services/projectFile', () => ({
  projectFileService: { getProjectFileIndex: services.getProjectFileIndex },
}));
vi.mock('@/services/git', () => ({
  gitService: { getGitWorkingTreeFiles: services.getGitWorkingTreeFiles },
}));
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDesktop: true,
}));
vi.mock('@/store/chat', () => ({ useChatStore: () => false }));
vi.mock('@/store/chat/selectors', () => ({ operationSelectors: {} }));
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => scope.current,
  isScopeTrusted: () => true,
  useCacheScope: () => scope.current,
}));

const tree = (names: string[]) => ({
  entries: names.map((name) => ({
    isDirectory: false,
    name,
    path: `/repo/${name}`,
    relativePath: name,
  })),
  indexedAt: 'now',
  root: '/repo',
  source: 'git' as const,
});

const never = () => new Promise<never>(() => {});

/** A fresh page: new store, replica engine and (empty) SWR cache. */
const boot = async (
  initialProps: { deviceId?: string; dir: string } = { deviceId: 'device-1', dir: '/repo' },
) => {
  vi.resetModules();
  const { useFilesTreeSources } =
    await import('@/features/Conversation/WorkingSidebar/Files/useFilesTreeSources');
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      SWRConfig,
      { value: { dedupingInterval: 0, provider: () => new Map() } },
      children,
    );
  return renderHook(
    ({ deviceId, dir }: { deviceId?: string; dir: string }) => useFilesTreeSources(deviceId, dir),
    { initialProps, wrapper },
  );
};

const readRows = async () => {
  const { localDatabase } = await import('@/libs/localDatabase');
  await localDatabase.initialize();
  return localDatabase;
};

beforeEach(() => {
  scope.current = 'u1:personal';
  services.getGitWorkingTreeFiles.mockReset();
  services.getProjectFileIndex.mockReset();
});

afterEach(async () => {
  const { localDatabase } = await import('@/libs/localDatabase');
  await localDatabase.initialize();
  await localDatabase.deleteByPrefix('query-projections', 'replica:');
});

describe('Files tab replicas', () => {
  it('paints the last tree and overlay after a reload, then refreshes them', async () => {
    services.getProjectFileIndex.mockResolvedValue(tree(['a.ts', 'b.ts']));
    services.getGitWorkingTreeFiles.mockResolvedValue({
      added: [],
      deleted: [],
      modified: ['a.ts'],
    });

    const first = await boot();
    await waitFor(() => expect(first.result.current.project.data?.entries).toHaveLength(2));
    await waitFor(() => expect(first.result.current.git.data?.modified).toEqual(['a.ts']));
    first.unmount();

    // Reload with a host that has not answered yet.
    let resolveIndex!: (value: unknown) => void;
    services.getProjectFileIndex.mockReturnValue(
      new Promise((resolve) => {
        resolveIndex = resolve;
      }),
    );
    services.getGitWorkingTreeFiles.mockReturnValue(never());

    const second = await boot();
    await waitFor(() =>
      expect(second.result.current.project.data?.entries.map((e) => e.name)).toEqual([
        'a.ts',
        'b.ts',
      ]),
    );
    expect(second.result.current.project.isLoading).toBe(false);
    expect(second.result.current.project.isValidating).toBe(true);
    expect(second.result.current.git.data?.modified).toEqual(['a.ts']);

    // The host answers: the saved tree is replaced in place.
    await act(async () => {
      resolveIndex(tree(['a.ts', 'b.ts', 'new-folder']));
    });
    await waitFor(() => expect(second.result.current.project.data?.entries).toHaveLength(3));
    second.unmount();
  });

  it('clears the saved tree and overlay when the host reports nothing', async () => {
    services.getProjectFileIndex.mockResolvedValue(tree(['a.ts']));
    services.getGitWorkingTreeFiles.mockResolvedValue({
      added: [],
      deleted: [],
      modified: ['a.ts'],
    });

    // This machine: an absent index is a confirmed "nothing to read there".
    const view = await boot({ deviceId: undefined, dir: '/repo' });
    await waitFor(() => expect(view.result.current.project.data?.entries).toHaveLength(1));
    await waitFor(() => expect(view.result.current.git.data?.modified).toEqual(['a.ts']));

    // The host has nothing to read there any more: both reads now resolve
    // without a result, which must clear the visible tree and its saved row.
    services.getProjectFileIndex.mockResolvedValue(undefined);
    services.getGitWorkingTreeFiles.mockResolvedValue(undefined);
    await act(async () => {
      await view.result.current.project.mutate();
      await view.result.current.git.mutate();
    });

    await waitFor(() => expect(view.result.current.project.data).toBeUndefined());
    await waitFor(() => expect(view.result.current.git.data).toBeUndefined());

    const db = await readRows();
    const rows = await db.entriesByPrefix<{ data: unknown }>(
      'query-projections',
      'replica:projectFileIndex:v1:',
    );
    expect(rows.filter(({ key }) => !key.includes('__replica'))).toHaveLength(0);
    view.unmount();
  });

  it('keeps a remote tree when the device read fails', async () => {
    services.getProjectFileIndex.mockResolvedValue(tree(['a.ts']));
    services.getGitWorkingTreeFiles.mockResolvedValue({ added: [], deleted: [], modified: [] });

    const view = await boot();
    await waitFor(() => expect(view.result.current.project.data?.entries).toHaveLength(1));

    // Offline / RPC timeout: the device router normalizes the missing result to
    // null. That is not a confirmed empty directory, so the cached tree and
    // its saved row must stay, with the refresh error exposed.
    services.getProjectFileIndex.mockResolvedValue(undefined);
    await act(async () => {
      await view.result.current.project.mutate().catch(() => {});
    });

    await waitFor(() => expect(view.result.current.project.error).toBeTruthy());
    expect(view.result.current.project.data?.entries).toHaveLength(1);

    const db = await readRows();
    const rows = await db.entriesByPrefix<{ data: unknown }>(
      'query-projections',
      'replica:projectFileIndex:v1:',
    );
    expect(rows.filter(({ key }) => !key.includes('__replica'))).toHaveLength(1);
    view.unmount();
  });

  it('keeps a remote overlay when the device read fails', async () => {
    services.getProjectFileIndex.mockResolvedValue(tree(['a.ts']));
    services.getGitWorkingTreeFiles.mockResolvedValue({
      added: [],
      deleted: [],
      modified: ['a.ts'],
    });

    const view = await boot();
    await waitFor(() => expect(view.result.current.git.data?.modified).toEqual(['a.ts']));

    services.getGitWorkingTreeFiles.mockResolvedValue(undefined);
    await act(async () => {
      await view.result.current.git.mutate().catch(() => {});
    });

    await waitFor(() => expect(view.result.current.git.error).toBeTruthy());
    expect(view.result.current.git.data?.modified).toEqual(['a.ts']);

    const db = await readRows();
    const rows = await db.entriesByPrefix<{ data: unknown }>(
      'query-projections',
      'replica:gitWorkingTreeFiles:v1:',
    );
    expect(rows.filter(({ key }) => !key.includes('__replica'))).toHaveLength(1);
    view.unmount();
  });

  it('keeps trees apart per identity, device and directory', async () => {
    services.getProjectFileIndex.mockResolvedValue(tree(['a.ts']));
    services.getGitWorkingTreeFiles.mockResolvedValue({ added: [], deleted: [], modified: [] });
    const first = await boot();
    await waitFor(() => expect(first.result.current.project.data?.entries).toHaveLength(1));
    first.unmount();

    services.getProjectFileIndex.mockReturnValue(never());
    services.getGitWorkingTreeFiles.mockReturnValue(never());

    // Another identity on the same device + directory sees nothing saved.
    scope.current = 'u2:personal';
    const otherUser = await boot();
    await waitFor(() => expect(otherUser.result.current.project.isValidating).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(otherUser.result.current.project.data).toBeUndefined();
    expect(otherUser.result.current.project.isLoading).toBe(true);

    // The same identity on another device, or another directory, neither.
    scope.current = 'u1:personal';
    otherUser.rerender({ deviceId: 'device-2', dir: '/repo' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(otherUser.result.current.project.data).toBeUndefined();
    otherUser.rerender({ deviceId: 'device-1', dir: '/other' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(otherUser.result.current.project.data).toBeUndefined();

    // And the original combination still restores.
    otherUser.rerender({ deviceId: 'device-1', dir: '/repo' });
    await waitFor(() => expect(otherUser.result.current.project.data?.entries).toHaveLength(1));
    otherUser.unmount();
  });

  it('stores the tree slim, not through the SWR cache', async () => {
    services.getProjectFileIndex.mockResolvedValue(tree(['a.ts']));
    services.getGitWorkingTreeFiles.mockResolvedValue({ added: [], deleted: [], modified: [] });
    const view = await boot();
    await waitFor(() => expect(view.result.current.project.data?.entries).toHaveLength(1));

    const db = await readRows();
    const rows = () =>
      db.entriesByPrefix<{ data: unknown }>('query-projections', 'replica:projectFileIndex:v1:');
    await waitFor(async () =>
      expect((await rows()).some(({ key }) => !key.includes('__replica'))).toBe(true),
    );
    const row = (await rows()).find(({ key }) => !key.includes('__replica'))!;
    // `[relativePath, flags]`: path and name derive from the root.
    expect((row.value.data as { entries: unknown[] }).entries).toEqual([['a.ts', 0]]);
    view.unmount();
  });

  it('does not keep an overlay past the path cap in the bounded index', async () => {
    services.getProjectFileIndex.mockResolvedValue(tree(['a.ts']));
    services.getGitWorkingTreeFiles.mockResolvedValue({
      added: [],
      deleted: [],
      modified: Array.from({ length: 5001 }, (_, index) => `f${index}.ts`),
    });

    const first = await boot();
    await waitFor(() => expect(first.result.current.git.data?.modified).toHaveLength(5001));

    // Nothing is stored: not the row, and not a ghost key in the index that
    // would later evict a real overlay from the bounded LRU.
    const db = await readRows();
    const rows = () =>
      db.entriesByPrefix<{ data: unknown }>('query-projections', 'replica:gitWorkingTreeFiles:v1:');
    await waitFor(async () => {
      const all = await rows();
      expect(all.filter(({ key }) => !key.includes('__replica'))).toHaveLength(0);
      const index = all.find(({ key }) => key.includes('__replica'));
      expect((index?.value.data as string[] | undefined) ?? []).toEqual([]);
    });
    first.unmount();

    // A reload has nothing to paint for that overlay.
    services.getGitWorkingTreeFiles.mockReturnValue(never());
    const second = await boot();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(second.result.current.git.data).toBeUndefined();
    second.unmount();
  });
});
