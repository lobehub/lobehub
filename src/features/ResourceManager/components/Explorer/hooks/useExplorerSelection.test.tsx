import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { initialState } from '@/routes/(main)/resource/features/store/initialState';

import { useExplorerSelectionActions } from './useExplorerSelection';

describe('useExplorerSelectionActions', () => {
  beforeEach(() => {
    useResourceManagerStore.setState(initialState);
  });

  it('should keep all-selection mode and store deselected ids as exclusions', () => {
    useResourceManagerStore.setState({ selectAllState: 'all', selectedFileIds: [] });

    const { result } = renderHook(() =>
      useExplorerSelectionActions([{ id: 'file-1' }, { id: 'file-2' }]),
    );

    act(() => {
      result.current.toggleItemSelection('file-1', false);
    });

    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'all',
      selectedFileIds: ['file-1'],
    });

    act(() => {
      result.current.toggleItemSelection('file-1', true);
    });

    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'all',
      selectedFileIds: [],
    });
  });

  it('should reselect excluded items on the current page without clearing cross-page selection', () => {
    useResourceManagerStore.setState({
      selectAllState: 'all',
      selectedFileIds: ['file-1', 'file-9'],
    });

    const { result } = renderHook(() =>
      useExplorerSelectionActions([{ id: 'file-1' }, { id: 'file-2' }]),
    );

    act(() => {
      result.current.handleSelectAll(true);
    });

    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'all',
      selectedFileIds: ['file-9'],
    });
  });
});
