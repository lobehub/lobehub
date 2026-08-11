import { describe, expect, it } from 'vitest';

import { FilesTabs, ResourceSourceFilter } from '@/types/files';

import { initialState, type State } from './initialState';
import {
  canFilterResourceSource,
  getExplorerSelectAllUiState,
  getExplorerSelectedCount,
  getResourceQueryVisibility,
  getResourceSourceFilter,
  isExplorerItemSelected,
} from './selectors';

const stateWith = (patch: Partial<State>): State => ({ ...initialState, ...patch });

describe('resource manager selectors', () => {
  it('should open the images category on generated output and every other category on all', () => {
    expect(getResourceSourceFilter(stateWith({ category: FilesTabs.Images }))).toBe(
      ResourceSourceFilter.Generated,
    );
    expect(getResourceSourceFilter(stateWith({ category: FilesTabs.Files }))).toBe(
      ResourceSourceFilter.All,
    );
  });

  it('should let an explicit pick override the category default', () => {
    expect(
      getResourceSourceFilter(
        stateWith({ category: FilesTabs.Images, sourceFilter: ResourceSourceFilter.Uploaded }),
      ),
    ).toBe(ResourceSourceFilter.Uploaded);
  });

  it('should not narrow by source inside a library or on categories without files', () => {
    const inLibrary = stateWith({
      category: FilesTabs.Images,
      libraryId: 'kb-1',
      sourceFilter: ResourceSourceFilter.Generated,
    });
    const pages = stateWith({ category: FilesTabs.Pages });

    expect(canFilterResourceSource(inLibrary)).toBe(false);
    expect(getResourceSourceFilter(inLibrary)).toBe(ResourceSourceFilter.All);
    expect(canFilterResourceSource(pages)).toBe(false);
    expect(getResourceSourceFilter(pages)).toBe(ResourceSourceFilter.All);
  });

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
