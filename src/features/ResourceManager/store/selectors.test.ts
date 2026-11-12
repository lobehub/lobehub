import { describe, expect, it } from 'vitest';

import { FilesTabs, ResourceSourceFilter, SortType } from '@/types/files';

import { initialState, type State } from './initialState';
import {
  canFilterResourceSource,
  compareResourceItems,
  getDefaultLibrarySort,
  getExplorerSelectAllUiState,
  getExplorerSelectedCount,
  getResourceQueryVisibility,
  getResourceSourceFilter,
  isExplorerItemSelected,
  sortFileList,
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

describe('resource ordering', () => {
  const row = (name: string, folder = false, sortOrder?: number) => ({
    id: name,
    name,
    fileType: folder ? 'custom/folder' : 'text/plain',
    metadata: { sortOrder },
    createdAt: new Date(0),
    size: 0,
  });

  it('applies distinct library and Drive defaults', () => {
    expect(getDefaultLibrarySort('kb-1')).toEqual({ sorter: 'custom', sortType: SortType.Asc });
    expect(getDefaultLibrarySort()).toEqual({ sorter: 'createdAt', sortType: SortType.Desc });
  });

  it('naturally orders numbered names and Chinese numbered prefixes without mutating input', () => {
    const rows = ['10_知识', '09_知识', '02_知识', '01_知识'].map((name) => row(name));
    expect(sortFileList(rows, 'custom', SortType.Asc)?.map((item) => item.name)).toEqual([
      '01_知识',
      '02_知识',
      '09_知识',
      '10_知识',
    ]);
    expect(rows[0].name).toBe('10_知识');
    expect(sortFileList([row('第10章'), row('第2章')], 'name', SortType.Asc)?.[0].name).toBe(
      '第2章',
    );
    expect(sortFileList([row('10'), row('2')], 'name', SortType.Asc)?.[0].name).toBe('2');
  });

  it('groups folders first in every mode and direction', () => {
    for (const sorter of ['custom', 'name', 'createdAt', 'size'] as const) {
      for (const direction of [SortType.Asc, SortType.Desc]) {
        expect(sortFileList([row('a'), row('z', true)], sorter, direction)?.[0].name).toBe('z');
      }
    }
  });

  it('puts finite custom weights before missing and invalid weights in both directions', () => {
    const rows = [row('A'), row('B', false, Infinity), row('Z', false, 0), row('C', false, 1000)];
    expect(sortFileList(rows, 'custom', SortType.Asc)?.map((item) => item.name)).toEqual([
      'Z',
      'C',
      'A',
      'B',
    ]);
    expect(sortFileList(rows, 'custom', SortType.Desc)?.map((item) => item.name)).toEqual([
      'C',
      'Z',
      'B',
      'A',
    ]);
    expect(
      compareResourceItems(
        { ...row('a'), id: '2' },
        { ...row('a'), id: '10' },
        'name',
        SortType.Asc,
      ),
    ).toBeLessThan(0);
  });
});
