import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { initialState } from '@/routes/(main)/resource/features/store/initialState';

import { isExplorerItemSelectable, useExplorerSelectionActions } from './useExplorerSelection';

const eligibilityMocks = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  currentUserId: 'user-1' as string | null,
  isWorkspaceOwner: false,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => eligibilityMocks.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => eligibilityMocks.isWorkspaceOwner,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { userId: string | null }) => unknown) =>
    selector({ userId: eligibilityMocks.currentUserId }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: (state: { userId: string | null }) => state.userId },
}));

describe('useExplorerSelectionActions', () => {
  beforeEach(() => {
    eligibilityMocks.activeWorkspaceId = null;
    eligibilityMocks.currentUserId = 'user-1';
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

  it('should let workspace members select only rows they uploaded', () => {
    eligibilityMocks.activeWorkspaceId = 'workspace-1';

    const { result } = renderHook(() =>
      useExplorerSelectionActions([
        { id: 'mine', userId: 'user-1' },
        { id: 'theirs', userId: 'user-2' },
      ]),
    );

    act(() => {
      result.current.toggleItemSelection('theirs', true);
      result.current.toggleItemSelection('mine', true);
    });

    expect(useResourceManagerStore.getState().selectedFileIds).toEqual(['mine']);
  });

  it('should let workspace owners select rows uploaded by any member', () => {
    eligibilityMocks.activeWorkspaceId = 'workspace-1';
    eligibilityMocks.isWorkspaceOwner = true;

    const { result } = renderHook(() =>
      useExplorerSelectionActions([{ id: 'theirs', userId: 'user-2' }]),
    );

    act(() => {
      result.current.toggleItemSelection('theirs', true);
    });

    expect(useResourceManagerStore.getState().selectedFileIds).toEqual(['theirs']);
  });
});

describe('isExplorerItemSelectable', () => {
  it('fails closed for unattributed workspace rows when the caller is not an owner', () => {
    expect(
      isExplorerItemSelectable({
        activeWorkspaceId: 'workspace-1',
        currentUserId: 'user-1',
        isWorkspaceOwner: false,
        itemUserId: null,
      }),
    ).toBe(false);
  });

  it('keeps personal rows and all owner-visible workspace rows selectable', () => {
    expect(
      isExplorerItemSelectable({
        currentUserId: 'user-1',
        isWorkspaceOwner: false,
        itemUserId: 'user-2',
      }),
    ).toBe(true);
    expect(
      isExplorerItemSelectable({
        activeWorkspaceId: 'workspace-1',
        currentUserId: 'user-1',
        isWorkspaceOwner: true,
        itemUserId: 'user-2',
      }),
    ).toBe(true);
  });
});
