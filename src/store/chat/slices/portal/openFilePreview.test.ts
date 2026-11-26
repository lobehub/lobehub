import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { PortalViewType } from './initialState';

describe('openFilePreview', () => {
  it('tags the preview with the conversation topic that opened it', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.clearPortalStack();
      result.current.openFilePreview({ fileId: 'file_1' }, { sourceTopicId: 'topic-1' });
    });

    expect(chatPortalSelectors.previewFileId(result.current)).toBe('file_1');
    expect(chatPortalSelectors.previewFileSourceTopicId(result.current)).toBe('topic-1');
  });

  it('leaves the source topic unset when opened outside a conversation', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.clearPortalStack();
      result.current.openFilePreview({ fileId: 'file_2' });
    });

    expect(result.current.portalStack.at(-1)).toEqual({
      file: { fileId: 'file_2' },
      type: PortalViewType.FilePreview,
    });
    expect(chatPortalSelectors.previewFileSourceTopicId(result.current)).toBeUndefined();
  });
});
