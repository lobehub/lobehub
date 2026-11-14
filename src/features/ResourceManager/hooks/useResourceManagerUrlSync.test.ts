// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { initialState } from '@/features/ResourceManager/store/initialState';
import { fileService } from '@/services/file';
import { useTreeStore } from '@/store/tree';
import { SortType } from '@/types/files';

import { useResourceManagerUrlSync } from './useResourceManagerUrlSync';

const setup = (url = '/resource') =>
  renderHook(
    () => {
      useResourceManagerUrlSync();
      const [params] = useSearchParams();
      return { navigate: useNavigate(), params };
    },
    {
      wrapper: ({ children }: PropsWithChildren) =>
        createElement(MemoryRouter, { initialEntries: [url] }, children),
    },
  );

beforeEach(() => {
  useTreeStore.getState().reset();
  useResourceManagerStore.setState(initialState);
});
afterEach(() => {
  cleanup();
  useTreeStore.getState().reset();
  vi.restoreAllMocks();
});

describe('useResourceManagerUrlSync', () => {
  it('defaults to custom ascending in a library, and createdAt descending in Drive', async () => {
    const { result } = setup();
    expect(useResourceManagerStore.getState()).toMatchObject({
      sorter: 'createdAt',
      sortType: SortType.Desc,
    });
    act(() => useResourceManagerStore.getState().setLibraryId('kb-1'));
    await waitFor(() =>
      expect(useResourceManagerStore.getState()).toMatchObject({
        sorter: 'custom',
        sortType: SortType.Asc,
      }),
    );
    expect(result.current.params.has('sorter')).toBe(false);
    act(() => useResourceManagerStore.getState().setLibraryId(undefined));
    await waitFor(() =>
      expect(useResourceManagerStore.getState()).toMatchObject({
        sorter: 'createdAt',
        sortType: SortType.Desc,
      }),
    );
  });

  it('initializes KB defaults when the library is supplied before the hook mounts', () => {
    useResourceManagerStore.setState({ libraryId: 'kb-1' });
    setup();
    expect(useResourceManagerStore.getState()).toMatchObject({
      sorter: 'custom',
      sortType: SortType.Asc,
    });
  });

  it('initializes explicit valid URL settings and keeps unrelated params', async () => {
    act(() => useResourceManagerStore.getState().setLibraryId('kb-1'));
    const { result } = setup('/resource?sorter=size&sortType=desc&file=page-1');
    await waitFor(() =>
      expect(useResourceManagerStore.getState()).toMatchObject({
        sorter: 'size',
        sortType: SortType.Desc,
      }),
    );
    expect(result.current.params.get('file')).toBe('page-1');
  });

  it('preserves a chosen sort through folder navigation that drops query parameters and remount', async () => {
    act(() => useResourceManagerStore.getState().setLibraryId('kb-1'));
    const hook = setup();
    act(() => useResourceManagerStore.getState().setSort('name', SortType.Asc));
    await waitFor(() => expect(hook.result.current.params.get('sorter')).toBe('name'));
    act(() => {
      void hook.result.current.navigate('/resource/folder/child');
    });
    await waitFor(() => expect(hook.result.current.params.get('sorter')).toBe('name'));
    expect(useResourceManagerStore.getState()).toMatchObject({
      sorter: 'name',
      sortType: SortType.Asc,
    });
    hook.unmount();
    const remounted = setup('/resource/folder/grandchild');
    await waitFor(() => expect(remounted.result.current.params.get('sorter')).toBe('name'));
  });

  it('synchronizes the active library sort to all loaded tree levels and future expansions', async () => {
    const getItems = vi
      .spyOn(fileService, 'getKnowledgeItems')
      .mockImplementation(() => new Promise(() => {}));
    const row = (id: string, folder = false) => ({
      id,
      name: id,
      isFolder: folder,
      fileType: folder ? 'custom/folder' : 'text/plain',
      url: '',
    });
    act(() => {
      useResourceManagerStore.getState().setLibraryId('kb-1');
      useTreeStore.setState({
        knowledgeBaseId: 'kb-1',
        children: {
          '': [row('2', true), row('10', true)],
          'level2': [row('2'), row('10')],
          'level3': [row('2'), row('10')],
        },
      });
    });
    act(() => useResourceManagerStore.getState().setSort('name', SortType.Desc));
    for (const items of Object.values(useTreeStore.getState().children)) {
      expect(items.map((item) => item.id)).toEqual(['10', '2']);
    }
    void useTreeStore.getState().loadChildren('level4');
    expect(getItems).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parentId: 'level4',
        sorter: 'name',
        sortType: SortType.Desc,
      }),
    );
    expect(getItems).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'level3', sorter: 'name' }),
    );
  });

  it('ignores invalid URL settings and accepts custom sorting', async () => {
    const invalid = setup('/resource?sorter=invalid&sortType=sideways');
    await waitFor(() => expect(invalid.result.current.params.has('sorter')).toBe(false));
    expect(useResourceManagerStore.getState().sorter).toBe('createdAt');
    invalid.unmount();
    setup('/resource?sorter=custom&sortType=asc');
    await waitFor(() =>
      expect(useResourceManagerStore.getState()).toMatchObject({
        sorter: 'custom',
        sortType: SortType.Asc,
      }),
    );
  });
});
