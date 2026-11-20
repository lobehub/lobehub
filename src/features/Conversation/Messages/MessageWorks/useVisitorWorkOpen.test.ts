import type { WorkSummaryItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVisitorWorkOpen } from './useVisitorWorkOpen';

const openFilePreview = vi.fn();
const { openCollectionModal } = vi.hoisted(() => ({ openCollectionModal: vi.fn() }));

vi.mock('@/features/CollectionModal/loader', () => ({ openCollectionModal }));
const conversationState = { context: { agentShareId: 'share_1', topicId: 'tpc_1' } };

vi.mock('../../store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) => selector(conversationState),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({ openFilePreview }),
}));

vi.mock('@/features/Work/ShareVisitorDocumentModal', () => ({
  createShareVisitorDocumentModal: vi.fn(),
}));

vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.lobehub.com' }));

const fileWork = (fileUrl?: string) =>
  ({
    event: { metadata: { fileId: 'file_1', filePath: '/hello_world.pptx', fileUrl } },
    id: 'wk_1',
    title: 'hello_world.pptx',
    type: 'file',
  }) as unknown as WorkSummaryItem;

describe('useVisitorWorkOpen', () => {
  beforeEach(() => {
    openFilePreview.mockReset();
    openCollectionModal.mockReset();
  });

  it('opens a collection with the images its card carries, and never asks for the versions', () => {
    const items = [{ fileId: 'file_1', url: 'https://app.lobehub.com/f/file_1' }];
    const { result } = renderHook(() => useVisitorWorkOpen());

    result.current({
      event: { metadata: { collection: { items } } },
      id: 'wk_collection',
      title: 'Shelf',
      type: 'collection',
    } as unknown as WorkSummaryItem);
    expect(openCollectionModal).toHaveBeenCalledWith({ items, title: 'Shelf' });

    // A row without images has nothing a visitor may load.
    openCollectionModal.mockReset();
    result.current({ id: 'wk_collection', type: 'collection' } as unknown as WorkSummaryItem);
    expect(openCollectionModal).not.toHaveBeenCalled();
  });

  it('previews a file Work in the portal from its public URL instead of a new tab', () => {
    // Regression: the visitor handler used to `window.open` the file URL,
    // leaving the share page for a bare download tab.
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useVisitorWorkOpen());

    result.current(fileWork('https://app.lobehub.com/f/file_1'));

    expect(openFilePreview).toHaveBeenCalledWith({
      fileId: 'file_1',
      source: { name: 'hello_world.pptx', url: 'https://app.lobehub.com/f/file_1' },
    });
    expect(windowOpen).not.toHaveBeenCalled();
    windowOpen.mockRestore();
  });

  it('previews from the /f/:id proxy instead of a non-http(s) file URL', () => {
    const { result } = renderHook(() => useVisitorWorkOpen());

    result.current(fileWork('javascript:alert(1)'));

    expect(openFilePreview).toHaveBeenCalledWith({
      fileId: 'file_1',
      source: { name: 'hello_world.pptx', url: 'https://app.lobehub.com/f/file_1' },
    });
  });

  // Regression: a file Work carrying only `fileId` (no persisted
  // URL) used to return early, so clicking its card did nothing.
  it('previews a file Work without a persisted URL from the /f/:id proxy', () => {
    const { result } = renderHook(() => useVisitorWorkOpen());

    result.current(fileWork());

    expect(openFilePreview).toHaveBeenCalledWith({
      fileId: 'file_1',
      source: { name: 'hello_world.pptx', url: 'https://app.lobehub.com/f/file_1' },
    });
  });
});
