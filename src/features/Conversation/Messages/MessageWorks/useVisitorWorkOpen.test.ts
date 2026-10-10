import type { WorkSummaryItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVisitorWorkOpen } from './useVisitorWorkOpen';

const openFilePreview = vi.fn();
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

const fileWork = (fileUrl: string) =>
  ({
    event: { metadata: { fileId: 'file_1', filePath: '/hello_world.pptx', fileUrl } },
    id: 'wk_1',
    title: 'hello_world.pptx',
    type: 'file',
  }) as unknown as WorkSummaryItem;

describe('useVisitorWorkOpen', () => {
  beforeEach(() => {
    openFilePreview.mockReset();
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

  it('does not open a preview for a non-http(s) file URL', () => {
    const { result } = renderHook(() => useVisitorWorkOpen());

    result.current(fileWork('javascript:alert(1)'));

    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
