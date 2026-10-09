import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePreviewFileItem } from './usePreviewFileItem';

const useFetchKnowledgeItem = vi.fn();
let portalFile: { fileId: string; source?: { name: string; url: string } } | undefined;

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    previewFileId: () => portalFile?.fileId,
    previewFileSource: () => portalFile?.source,
  },
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: unknown) => unknown) => selector({ useFetchKnowledgeItem }),
}));

describe('usePreviewFileItem', () => {
  beforeEach(() => {
    useFetchKnowledgeItem.mockReset();
    useFetchKnowledgeItem.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('renders a pre-resolved source without the owner-scoped file fetch', () => {
    // A share visitor cannot read the creator's file item; the fetch would 404
    // and the portal would show "file not found" instead of the preview.
    portalFile = {
      fileId: 'file_1',
      source: { name: 'hello_world.pptx', url: 'https://app.lobehub.com/f/file_1' },
    };

    const { result } = renderHook(() => usePreviewFileItem());

    expect(useFetchKnowledgeItem).toHaveBeenCalledWith(undefined);
    expect(result.current).toMatchObject({
      data: {
        id: 'file_1',
        name: 'hello_world.pptx',
        url: 'https://app.lobehub.com/f/file_1',
      },
      fromSource: true,
      isLoading: false,
    });
  });

  it('fetches the file item when the view carries no source', () => {
    portalFile = { fileId: 'file_2' };
    const data = { id: 'file_2', name: 'report.pdf' };
    useFetchKnowledgeItem.mockReturnValue({ data, isLoading: false, mutate: vi.fn() });

    const { result } = renderHook(() => usePreviewFileItem());

    expect(useFetchKnowledgeItem).toHaveBeenCalledWith('file_2');
    expect(result.current.data).toBe(data);
    expect(result.current.fromSource).toBe(false);
  });
});
