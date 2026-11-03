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
  it('should open the images category on generated output and the other media categories on all', () => {
    expect(getResourceSourceFilter(stateWith({ category: FilesTabs.Images }))).toBe(
      ResourceSourceFilter.Generated,
    );
    expect(getResourceSourceFilter(stateWith({ category: FilesTabs.Videos }))).toBe(
      ResourceSourceFilter.All,
    );
    expect(getResourceSourceFilter(stateWith({ category: FilesTabs.Audios }))).toBe(
      ResourceSourceFilter.All,
    );
  });

  it('should offer the source filter on media categories only', () => {
    for (const category of [FilesTabs.Images, FilesTabs.Videos, FilesTabs.Audios]) {
      expect(canFilterResourceSource(stateWith({ category }))).toBe(true);
    }

    // Documents and raw files have no generated counterpart, and All is a
    // cross-category overview — the filter could only ever partition those one
    // way, so it is not offered at all.
    for (const category of [
      FilesTabs.All,
      FilesTabs.Documents,
      FilesTabs.Files,
      FilesTabs.Pages,
      FilesTabs.Home,
    ]) {
      expect(canFilterResourceSource(stateWith({ category }))).toBe(false);
      expect(getResourceSourceFilter(stateWith({ category }))).toBe(ResourceSourceFilter.All);
    }
  });

  it('should let an explicit pick override the category default', () => {
    expect(
      getResourceSourceFilter(
        stateWith({ category: FilesTabs.Images, sourceFilter: ResourceSourceFilter.Uploaded }),
      ),
    ).toBe(ResourceSourceFilter.Uploaded);
  });

  it('should not narrow by source inside a library, even on a media category', () => {
    const inLibrary = stateWith({
      category: FilesTabs.Images,
      libraryId: 'kb-1',
      sourceFilter: ResourceSourceFilter.Generated,
    });

    expect(canFilterResourceSource(inLibrary)).toBe(false);
    expect(getResourceSourceFilter(inLibrary)).toBe(ResourceSourceFilter.All);
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
