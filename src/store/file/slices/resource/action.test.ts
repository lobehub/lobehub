import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState } from '@/store/file/initialState';
import { useFileStore } from '@/store/file/store';
import type { ResourceItem } from '@/types/resource';

const { mockMoveResource } = vi.hoisted(() => ({
  mockMoveResource: vi.fn(),
}));

vi.mock('@/services/resource', () => ({
  resourceService: {
    moveResource: mockMoveResource,
  },
}));

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

describe('resource actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileStore.setState(initialState);
  });

  it('should keep completed background uploads out of the current resource list when they are off-screen', () => {
    const visibleResource = createResource({
      id: 'visible-1',
      name: 'Visible resource',
      parentId: 'folder-b',
    });
    const optimisticResource = createResource({
      _optimistic: {
        isPending: true,
        retryCount: 0,
      },
      id: 'temp-a',
      name: 'Background upload',
      parentId: 'folder-a',
    });
    const completedResource = createResource({
      id: 'file-a',
      name: 'Background upload',
      parentId: 'folder-a',
    });

    useFileStore.setState({
      queryParams: { parentId: 'folder-b' },
      resourceList: [visibleResource],
      resourceMap: new Map([
        [visibleResource.id, visibleResource],
        [optimisticResource.id, optimisticResource],
      ]),
    });

    useFileStore.getState().replaceLocalResource(optimisticResource.id, completedResource);

    const { resourceList, resourceMap } = useFileStore.getState();

    expect(resourceList).toEqual([visibleResource]);
    expect(resourceMap.has(optimisticResource.id)).toBe(false);
    expect(resourceMap.get(completedResource.id)).toEqual(completedResource);
  });

  it('should remove a root item from the visible list when moving it into a folder', async () => {
    const rootResource = createResource({
      id: 'root-1',
      name: 'Root resource',
      parentId: null,
    });
    const movedResource = createResource({
      id: 'root-1',
      name: 'Root resource',
      parentId: 'folder-a',
    });

    mockMoveResource.mockResolvedValue(movedResource);

    useFileStore.setState({
      queryParams: { parentId: null },
      resourceList: [rootResource],
      resourceMap: new Map([[rootResource.id, rootResource]]),
    });

    await useFileStore.getState().moveResource(rootResource.id, 'folder-a');

    const { resourceList, resourceMap } = useFileStore.getState();

    expect(resourceList).toEqual([]);
    expect(resourceMap.has(rootResource.id)).toBe(false);
  });
});
