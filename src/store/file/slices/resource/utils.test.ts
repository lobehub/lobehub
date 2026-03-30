import { describe, expect, it } from 'vitest';

import type { ResourceItem } from '@/types/resource';

import { getResourceQueryKey, mergeServerResourcesWithOptimistic } from './utils';

const createResource = (overrides: Partial<ResourceItem> = {}): ResourceItem => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  fileType: 'text/plain',
  id: 'resource-1',
  name: 'Resource 1',
  parentId: null,
  size: 1,
  sourceType: 'file',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  url: 'files/resource-1.txt',
  ...overrides,
});

describe('mergeServerResourcesWithOptimistic', () => {
  it('should preserve optimistic resources from other queries in the global resource map', () => {
    const offscreenOptimistic = createResource({
      _optimistic: {
        isPending: true,
        queryKey: getResourceQueryKey({ parentId: 'folder-a' }),
        retryCount: 0,
      },
      id: 'temp-a',
      name: 'Offscreen upload',
      parentId: 'folder-a',
    });
    const currentServerItem = createResource({
      id: 'file-b',
      name: 'Visible item',
      parentId: 'folder-b',
    });

    const merged = mergeServerResourcesWithOptimistic(
      [currentServerItem],
      new Map([[offscreenOptimistic.id, offscreenOptimistic]]),
      { parentId: 'folder-b' },
    );

    expect(merged.resourceList).toEqual([currentServerItem]);
    expect(merged.resourceMap.get(offscreenOptimistic.id)).toEqual(offscreenOptimistic);
    expect(merged.resourceMap.get(currentServerItem.id)).toEqual(currentServerItem);
  });
});
