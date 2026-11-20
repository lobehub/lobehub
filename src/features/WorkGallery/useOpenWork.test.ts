import type { WorkSummaryItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useOpenWork } from './useOpenWork';

const { createModal, getVersion } = vi.hoisted(() => ({
  createModal: vi.fn(),
  getVersion: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({ createModal }));
vi.mock('@/services/canvas', () => ({ canvasService: { getVersion } }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/features/Work/descriptors', () => ({
  getWorkTypeDescriptor: () => ({
    getOpenTarget: (item: WorkSummaryItem) => ({
      canvasId: item.resourceId,
      kind: 'canvas',
    }),
  }),
  isSafeExternalUrl: () => true,
}));
vi.mock('@/features/DocumentModal/loader', () => ({ openDocumentModal: vi.fn() }));
vi.mock('@/components/AsyncBoundary', () => ({ default: () => null }));
vi.mock('@/libs/swr', () => ({ useClientDataSWR: vi.fn() }));
vi.mock('@/features/Conversation/WorkingSidebar/Canvas/CanvasFrame', () => ({
  default: () => null,
}));

describe('useOpenWork Canvas entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    getVersion.mockResolvedValue({ canvasId: 'cvs_gallery', version: 2 });
  });

  it('opens an in-app preview without depending on a private preview URL', async () => {
    const { result } = renderHook(() => useOpenWork());
    await act(async () => {
      result.current({ resourceId: 'cvs_gallery', type: 'canvas' } as WorkSummaryItem);
    });

    await waitFor(() => expect(createModal).toHaveBeenCalledOnce());
    expect(window.open).not.toHaveBeenCalled();
  });
});
