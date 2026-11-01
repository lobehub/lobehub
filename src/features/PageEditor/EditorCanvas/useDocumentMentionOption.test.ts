import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentMentionOption } from './useDocumentMentionOption';

const mockPageEditorState: {
  current: { isWorkspacePage?: boolean; isWorkspaceScopedPage?: boolean };
} = { current: {} };

vi.mock('../store', () => ({
  usePageEditorStore: (selector: any) => selector(mockPageEditorState.current),
}));

const MENTION_OPTION = { items: [{ key: 'member-1', label: 'Alex' }] };
vi.mock('@/features/Portal/TopicComments/useWorkspaceCommentMentionOption', () => ({
  useWorkspaceCommentMentionOption: () => MENTION_OPTION,
}));

describe('useDocumentMentionOption', () => {
  beforeEach(() => {
    mockPageEditorState.current = {};
  });

  it('offers the workspace member source on a workspace page', () => {
    mockPageEditorState.current = { isWorkspacePage: true, isWorkspaceScopedPage: true };

    const { result } = renderHook(() => useDocumentMentionOption());

    expect(result.current).toBe(MENTION_OPTION);
  });

  it('offers it on a private workspace draft too', () => {
    // A page created from the sidebar starts as 私人 (`isWorkspacePage` false
    // because it never takes the collaborative lock). Gating `@` on that flag
    // hid the member menu exactly where most pages begin.
    mockPageEditorState.current = { isWorkspacePage: false, isWorkspaceScopedPage: true };

    const { result } = renderHook(() => useDocumentMentionOption());

    expect(result.current).toBe(MENTION_OPTION);
  });

  it('stays off on a personal page outside any workspace', () => {
    mockPageEditorState.current = { isWorkspacePage: false, isWorkspaceScopedPage: false };

    const { result } = renderHook(() => useDocumentMentionOption());

    expect(result.current).toBeUndefined();
  });
});
