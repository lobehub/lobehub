import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { initialState } from '@/features/ResourceManager/store/initialState';

import { isExplorerItemSelectable, useExplorerSelectionActions } from './useExplorerSelection';

const eligibilityMocks = vi.hoisted(() => ({ isWorkspaceOwner: false }));

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => eligibilityMocks.isWorkspaceOwner,
}));

describe('useExplorerSelectionActions', () => {
  beforeEach(() => {
    eligibilityMocks.isWorkspaceOwner = false;
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

  it('should let workspace members select visible rows uploaded by any member', () => {
    const { result } = renderHook(() =>
      useExplorerSelectionActions([{ id: 'mine' }, { id: 'theirs' }]),
    );

    act(() => {
      result.current.toggleItemSelection('theirs', true);
      result.current.toggleItemSelection('mine', true);
    });

    expect(useResourceManagerStore.getState().selectedFileIds).toEqual(['theirs', 'mine']);
  });

  it('should let workspace owners select rows uploaded by any member', () => {
    eligibilityMocks.isWorkspaceOwner = true;

    const { result } = renderHook(() => useExplorerSelectionActions([{ id: 'theirs' }]));

    act(() => {
      result.current.toggleItemSelection('theirs', true);
    });

    expect(useResourceManagerStore.getState().selectedFileIds).toEqual(['theirs']);
  });
});

describe('isExplorerItemSelectable', () => {
  it('keeps every row returned by the visibility-scoped query selectable', () => {
    expect(isExplorerItemSelectable()).toBe(true);
  });
});
