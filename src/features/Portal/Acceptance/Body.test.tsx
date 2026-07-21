import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Body from './Body';

const mocks = vi.hoisted(() => ({
  captured: { onDraftToComposer: undefined as undefined | ((text: string) => boolean) },
  editor: { focus: vi.fn(), setDocument: vi.fn() } as { focus: any; setDocument: any } | null,
  state: {} as { editor: unknown; updateInputMessage: (m: string) => void },
  updateInputMessage: vi.fn(),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { acceptancePortalId: () => 'acc-1' },
}));

vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('@/features/Verify', () => ({
  AcceptanceViewer: (props: { onDraftToComposer?: (text: string) => boolean }) => {
    mocks.captured.onDraftToComposer = props.onDraftToComposer;
    return null;
  },
}));

describe('Portal Acceptance Body — draftToComposer', () => {
  it('drafts into the composer AND syncs inputMessage so Send enables', () => {
    const editor = { focus: vi.fn(), setDocument: vi.fn() };
    mocks.state = { editor, updateInputMessage: mocks.updateInputMessage };
    render(<Body />);

    const ok = mocks.captured.onDraftToComposer?.('please fix X');

    expect(ok).toBe(true);
    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'please fix X');
    // P1 regression: setDocument alone does not fire the change handler, leaving
    // Send disabled — the owning input state must be synced explicitly.
    expect(mocks.updateInputMessage).toHaveBeenCalledWith('please fix X');
    expect(editor.focus).toHaveBeenCalled();
  });

  it('reports failure (so the caller skips its toast) when no composer is mounted', () => {
    mocks.updateInputMessage.mockClear();
    mocks.state = { editor: null, updateInputMessage: mocks.updateInputMessage };
    render(<Body />);

    const ok = mocks.captured.onDraftToComposer?.('please fix X');

    expect(ok).toBe(false);
    expect(mocks.updateInputMessage).not.toHaveBeenCalled();
  });
});
