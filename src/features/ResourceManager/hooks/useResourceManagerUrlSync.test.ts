import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { SortType } from '@/types/files';

import { useResourceManagerUrlSync } from './useResourceManagerUrlSync';

const renderWithUrl = (url: string) =>
  renderHook(
    () => {
      useResourceManagerUrlSync();
      return useLocation().search;
    },
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: [url] }, children),
    },
  );

describe('useResourceManagerUrlSync', () => {
  beforeEach(() => {
    useResourceManagerStore.setState({ sorter: 'createdAt', sortType: SortType.Desc });
  });

  it('restores a supported bookmarked sort into the store and URL', async () => {
    const { result } = renderWithUrl('/resource/images?sorter=name&sortType=asc');

    await waitFor(() => {
      expect(useResourceManagerStore.getState()).toMatchObject({
        sorter: 'name',
        sortType: SortType.Asc,
      });
      expect(result.current).toBe('?sorter=name&sortType=asc');
    });
  });

  it('normalizes unsupported bookmarked sorting before the list queries it', async () => {
    const { result } = renderWithUrl('/resource/images?sorter=updatedAt&sortType=invalid');

    await waitFor(() => {
      expect(useResourceManagerStore.getState()).toMatchObject({
        sorter: 'createdAt',
        sortType: SortType.Desc,
      });
      expect(result.current).toBe('');
    });
  });
});
