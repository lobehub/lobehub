import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { initialState } from '@/routes/(main)/resource/features/store/initialState';
import { FilesTabs } from '@/types/files';

import { useResetSelectionOnQueryChange } from './useResetSelectionOnQueryChange';

describe('useResetSelectionOnQueryChange', () => {
  beforeEach(() => {
    useResourceManagerStore.setState(initialState);
  });

  it('should clear all-selection mode when the search query changes', () => {
    const { rerender } = renderHook(
      (props: { searchQuery: string | null }) =>
        useResetSelectionOnQueryChange({
          category: FilesTabs.All,
          currentFolderSlug: 'folder-a',
          libraryId: undefined,
          searchQuery: props.searchQuery,
        }),
      {
        initialProps: { searchQuery: null as string | null },
      },
    );

    act(() => {
      useResourceManagerStore.setState({
        selectAllState: 'all',
        selectedFileIds: ['file-1'],
      });
    });

    act(() => {
      rerender({ searchQuery: 'report' });
    });

    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'none',
      selectedFileIds: [],
    });
  });

  it('should clear selection when the folder changes', () => {
    const { rerender } = renderHook(
      (props: { currentFolderSlug: string | null }) =>
        useResetSelectionOnQueryChange({
          category: FilesTabs.All,
          currentFolderSlug: props.currentFolderSlug,
          libraryId: undefined,
          searchQuery: null,
        }),
      {
        initialProps: { currentFolderSlug: 'folder-a' },
      },
    );

    act(() => {
      useResourceManagerStore.setState({
        selectAllState: 'loaded',
        selectedFileIds: ['file-1', 'file-2'],
      });
    });

    act(() => {
      rerender({ currentFolderSlug: 'folder-b' });
    });

    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'none',
      selectedFileIds: [],
    });
  });
});
