import { describe, expect, it } from 'vitest';

import {
  getExplorerSelectAllUiState,
  getExplorerSelectedCount,
  getResourceQueryVisibility,
  isExplorerItemSelected,
} from './selectors';

describe('resource manager selectors', () => {
  it('should apply the home visibility filter only outside a concrete library', () => {
    expect(getResourceQueryVisibility(undefined, 'private')).toBe('private');
    expect(getResourceQueryVisibility(undefined, 'workspace')).toBe('public');
    expect(getResourceQueryVisibility('kb-shared', 'private')).toBeUndefined();
    expect(getResourceQueryVisibility('kb-shared', 'workspace')).toBeUndefined();
  });

  it('should treat selected ids as exclusions in all-selection mode', () => {
    expect(
      isExplorerItemSelected({
        id: 'file-1',
        selectAllState: 'all',
        selectedIds: ['file-1'],
      }),
    ).toBe(false);
    expect(
      isExplorerItemSelected({
        id: 'file-2',
        selectAllState: 'all',
        selectedIds: ['file-1'],
      }),
    ).toBe(true);
    expect(
      getExplorerSelectedCount({
        selectAllState: 'all',
        selectedIds: ['file-1'],
        total: 5,
      }),
    ).toBe(4);
  });

  it('should show an indeterminate checkbox when a loaded item is excluded from all-selection mode', () => {
    expect(
      getExplorerSelectAllUiState({
        data: [{ id: 'file-1' }, { id: 'file-2' }],
        hasMore: true,
        selectAllState: 'all',
        selectedIds: ['file-1'],
      }),
    ).toEqual({
      allSelected: false,
      indeterminate: true,
      showSelectAllHint: true,
    });
  });
});
