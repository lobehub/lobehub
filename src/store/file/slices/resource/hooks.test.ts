import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate } from '@/libs/swr';
import type { FilesTabs } from '@/types/files';

import { revalidateResources, useFetchResources } from './hooks';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  queryParams: {
    category: 'audios' as FilesTabs,
    parentId: null,
    showFilesInKnowledgeBase: false,
  },
  useClientDataSWR: vi.fn(() => ({ data: undefined })),
  activeWorkspaceId: null as string | null,
}));

vi.mock('@/libs/swr', () => ({
  mutate: mocks.mutate,
  useClientDataSWR: mocks.useClientDataSWR,
}));

vi.mock('../../store', () => ({
  useFileStore: {
    getState: () => ({
      queryParams: mocks.queryParams,
    }),
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: vi.fn(() => mocks.activeWorkspaceId),
  useActiveWorkspaceId: vi.fn(() => mocks.activeWorkspaceId),
}));

describe('revalidateResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = null;
  });

  it('matches workspace-scoped resource SWR keys', async () => {
    mocks.activeWorkspaceId = 'workspace-1';

    await revalidateResources();

    const [matcher] = vi.mocked(mutate).mock.calls[0] as [(key: unknown) => boolean];

    expect(matcher).toEqual(expect.any(Function));
    expect(matcher(['resource:list', mocks.queryParams, 'workspace-1'])).toBe(true);
    expect(matcher(['resource:list', mocks.queryParams, 'workspace-2'])).toBe(false);
    expect(matcher(['resource:list', mocks.queryParams])).toBe(false);
    expect(matcher(['OTHER_KEY', mocks.queryParams, 'workspace-1'])).toBe(false);
    expect(getActiveWorkspaceId).toHaveBeenCalled();
  });
});

describe('useFetchResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = null;
  });

  it('scopes the resource SWR key by active workspace', () => {
    mocks.activeWorkspaceId = 'workspace-1';

    renderHook(() => useFetchResources(mocks.queryParams));

    expect(mocks.useClientDataSWR).toHaveBeenCalledWith(
      ['resource:list', mocks.queryParams, 'workspace-1'],
      expect.any(Function),
      expect.any(Object),
    );
    expect(useActiveWorkspaceId).toHaveBeenCalled();
  });
});
