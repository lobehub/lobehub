import type { DeviceDirectoryBrowseResult } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';

import { useFetchDeviceDirectory } from './directoryHooks';

const folder = (name: string) => ({
  isSymlink: false,
  name,
  path: `/home/${name}`,
  readable: true,
});
const page = (
  overrides: Partial<DeviceDirectoryBrowseResult> = {},
): DeviceDirectoryBrowseResult => ({
  entries: [folder('projects')],
  parentPath: '/',
  path: '/home',
  pathSeparator: '/',
  roots: ['/'],
  truncated: false,
  ...overrides,
});
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);

afterEach(() => vi.restoreAllMocks());

describe('useFetchDeviceDirectory', () => {
  it('shows the canonical home directory and appends subsequent pages', async () => {
    vi.spyOn(deviceService, 'browseDirectory').mockImplementation(async ({ cursor, path }) => {
      if (!cursor) return page({ nextCursor: '1', truncated: true });
      return path === '/home' ? page({ entries: [folder('work')] }) : null;
    });
    const { result } = renderHook(() => useFetchDeviceDirectory('device'), { wrapper });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home'));
    expect(result.current.hasMore).toBe(true);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.entries.map(({ name }) => name)).toEqual(['projects', 'work']);
    expect(result.current.hasMore).toBe(false);
  });

  it('reports an unavailable device as an error, then recovers on retry', async () => {
    vi.spyOn(deviceService, 'browseDirectory')
      .mockResolvedValueOnce(null)
      .mockResolvedValue(page());
    const { result } = renderHook(() => useFetchDeviceDirectory('device'), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.directory).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home'));
    expect(result.current.error).toBeUndefined();
  });

  it('retains loaded folders when pagination fails and retries the missing page', async () => {
    let fail = true;
    vi.spyOn(deviceService, 'browseDirectory').mockImplementation(async ({ cursor }) => {
      if (!cursor) return page({ nextCursor: '1', truncated: true });
      if (fail) throw new Error('Disconnected');
      return page({ entries: [folder('work')] });
    });
    const { result } = renderHook(() => useFetchDeviceDirectory('device'), { wrapper });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.entries.map(({ name }) => name)).toEqual(['projects']);
    expect(result.current.isLoadingMore).toBe(false);
    fail = false;
    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.error).toBeUndefined();
  });

  it('does not show the previous directory while a new location loads or fails', async () => {
    vi.spyOn(deviceService, 'browseDirectory').mockImplementation(async ({ path }) => {
      if (path === '/missing') throw new Error('Permission denied');
      return page();
    });
    const { result, rerender } = renderHook(({ path }) => useFetchDeviceDirectory('device', path), {
      initialProps: { path: '/home' },
      wrapper,
    });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home'));
    rerender({ path: '/missing' });
    expect(result.current.directory).toBeUndefined();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.entries).toEqual([]);
  });

  it('ignores a late response from the previous location', async () => {
    let resolveOld!: (result: DeviceDirectoryBrowseResult) => void;
    vi.spyOn(deviceService, 'browseDirectory').mockImplementation(async ({ path }) => {
      if (path === '/slow')
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return page({ entries: [], parentPath: null, path: '/' });
    });
    const { result, rerender } = renderHook(({ path }) => useFetchDeviceDirectory('device', path), {
      initialProps: { path: '/slow' },
      wrapper,
    });
    await waitFor(() => expect(resolveOld).toBeDefined());
    rerender({ path: '/' });
    await waitFor(() => expect(result.current.directory?.path).toBe('/'));
    await act(async () => {
      resolveOld(page({ path: '/slow' }));
    });
    expect(result.current.directory?.path).toBe('/');
    expect(result.current.directory?.parentPath).toBeNull();
    expect(result.current.entries).toEqual([]);
  });

  it('resets pagination when navigating to another directory', async () => {
    vi.spyOn(deviceService, 'browseDirectory').mockImplementation(async ({ path, cursor }) => {
      if (path === '/next')
        return page({ path: '/next', entries: [folder('next')], nextCursor: '1', truncated: true });
      return page({
        entries: [folder(cursor ? 'second' : 'first')],
        nextCursor: cursor ? undefined : '1',
        truncated: !cursor,
      });
    });
    const { result, rerender } = renderHook(({ path }) => useFetchDeviceDirectory('device', path), {
      initialProps: { path: '/home' },
      wrapper,
    });
    await waitFor(() => expect(result.current.directory).toBeDefined());
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.entries).toHaveLength(2);
    rerender({ path: '/next' });
    await waitFor(() => expect(result.current.directory?.path).toBe('/next'));
    expect(result.current.entries.map(({ name }) => name)).toEqual(['next']);
    expect(result.current.hasMore).toBe(true);
  });

  it('serves a revisited directory from cache and reloads it on refresh', async () => {
    const listings: Record<string, DeviceDirectoryBrowseResult> = {
      '/home': page({ entries: [folder('projects')], path: '/home' }),
      '/home/projects': page({ entries: [], parentPath: '/home', path: '/home/projects' }),
    };
    const browse = vi
      .spyOn(deviceService, 'browseDirectory')
      .mockImplementation(async ({ path }) => listings[path ?? '/home']);
    const homeRequests = () => browse.mock.calls.filter(([input]) => input.path === '/home');
    const { result, rerender } = renderHook(({ path }) => useFetchDeviceDirectory('device', path), {
      initialProps: { path: '/home' },
      wrapper,
    });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home'));

    // A folder appears on the device while the picker is elsewhere.
    listings['/home'] = page({ entries: [folder('ops'), folder('projects')], path: '/home' });
    rerender({ path: '/home/projects' });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home/projects'));
    rerender({ path: '/home' });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home'));
    expect(result.current.entries.map(({ name }) => name)).toEqual(['projects']);
    expect(homeRequests()).toHaveLength(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.entries.map(({ name }) => name)).toEqual(['ops', 'projects']);
    expect(homeRequests()).toHaveLength(2);
  });

  it('keeps the listing visible and flags it while a refresh is in flight', async () => {
    let resolveRefresh: ((result: DeviceDirectoryBrowseResult) => void) | undefined;
    vi.spyOn(deviceService, 'browseDirectory')
      .mockResolvedValueOnce(page())
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    const { result } = renderHook(() => useFetchDeviceDirectory('device', '/home'), { wrapper });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home'));
    expect(result.current.isRefreshing).toBe(false);

    let refreshed!: Promise<void>;
    act(() => {
      refreshed = result.current.refresh();
    });
    await waitFor(() => expect(resolveRefresh).toBeDefined());
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.entries.map(({ name }) => name)).toEqual(['projects']);

    await act(async () => {
      resolveRefresh?.(page({ entries: [folder('ops'), folder('projects')] }));
      await refreshed;
    });
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.entries.map(({ name }) => name)).toEqual(['ops', 'projects']);
  });

  it('reloads the parent after a refresh raced a move into a new child', async () => {
    const listings: Record<string, DeviceDirectoryBrowseResult> = {
      '/home': page({ entries: [folder('projects')], path: '/home' }),
      '/home/new': page({ entries: [], parentPath: '/home', path: '/home/new' }),
    };
    const browse = vi
      .spyOn(deviceService, 'browseDirectory')
      .mockImplementation(async ({ path }) => listings[path ?? '/home']);
    const { result, rerender } = renderHook(({ path }) => useFetchDeviceDirectory('device', path), {
      initialProps: { path: '/home' },
      wrapper,
    });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home'));

    // The new-folder flow: the folder now exists, refresh the listing and
    // open the new folder in the same tick.
    listings['/home'] = page({ entries: [folder('new'), folder('projects')], path: '/home' });
    act(() => {
      void result.current.retry();
    });
    rerender({ path: '/home/new' });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home/new'));

    rerender({ path: '/home' });
    await waitFor(() => expect(result.current.directory?.path).toBe('/home'));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.entries.map(({ name }) => name)).toEqual(['new', 'projects']);
    expect(browse.mock.calls.length).toBeLessThan(10);
  });
});
