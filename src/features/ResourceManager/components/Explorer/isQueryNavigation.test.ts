import { describe, expect, it } from 'vitest';

import { FilesTabs, ResourceSourceFilter, SortType } from '@/types/files';
import type { ResourceQueryParams } from '@/types/resource';

import { isQueryNavigation } from './isQueryNavigation';

const base: ResourceQueryParams = {
  category: FilesTabs.Images,
  libraryId: undefined,
  parentId: null,
  sortType: SortType.Desc,
  sorter: 'createdAt',
  sourceFilter: ResourceSourceFilter.Generated,
  visibility: 'public',
};

describe('isQueryNavigation', () => {
  it('should treat a source change as navigation', () => {
    // Regression: both views used to compare four fields and omit this one, so
    // switching source kept the previous source's rows on screen — and
    // interactive — until the new fetch landed.
    expect(isQueryNavigation(base, { ...base, sourceFilter: ResourceSourceFilter.Uploaded })).toBe(
      true,
    );
  });

  it('should treat every other pool-selecting field as navigation', () => {
    expect(isQueryNavigation(base, { ...base, category: FilesTabs.Videos })).toBe(true);
    expect(isQueryNavigation(base, { ...base, libraryId: 'kb-1' })).toBe(true);
    expect(isQueryNavigation(base, { ...base, parentId: 'folder-1' })).toBe(true);
    expect(isQueryNavigation(base, { ...base, visibility: 'private' })).toBe(true);
  });

  it('should not treat re-sorting the same pool as navigation', () => {
    // Sorting rearranges the rows already loaded, so a skeleton there would be
    // a flash for nothing.
    expect(isQueryNavigation(base, { ...base, sortType: SortType.Asc })).toBe(false);
    expect(isQueryNavigation(base, { ...base, sorter: 'name' })).toBe(false);
  });

  it('should report no navigation for identical params or a missing side', () => {
    expect(isQueryNavigation(base, { ...base })).toBe(false);
    expect(isQueryNavigation(undefined, base)).toBe(false);
    expect(isQueryNavigation(base, undefined)).toBe(false);
  });
});
