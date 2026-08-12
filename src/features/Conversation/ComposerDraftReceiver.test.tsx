import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { draftToMainComposer, useComposerDraftBus } from './composerDraftBus';
import ComposerDraftReceiver from './ComposerDraftReceiver';

const mocks = vi.hoisted(() => ({
  editor: null as null | { focus: ReturnType<typeof vi.fn>; setDocument: ReturnType<typeof vi.fn> },
  updateInputMessage: vi.fn(),
}));

vi.mock('./store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) =>
    selector({ editor: mocks.editor, updateInputMessage: mocks.updateInputMessage }),
}));

describe('ComposerDraftReceiver', () => {
  beforeEach(() => {
    useComposerDraftBus.setState({ attached: false, draft: null });
    mocks.editor = null;
    mocks.updateInputMessage.mockClear();
  });

  it('attaches the bus only while a live editor is mounted', () => {
    mocks.editor = { focus: vi.fn(), setDocument: vi.fn() };
    const { unmount } = render(<ComposerDraftReceiver />);
    expect(useComposerDraftBus.getState().attached).toBe(true);

    unmount();
    expect(useComposerDraftBus.getState().attached).toBe(false);
  });

  it('applies a posted draft: setDocument + inputMessage sync + focus, then clears it', () => {
    mocks.editor = { focus: vi.fn(), setDocument: vi.fn() };
    render(<ComposerDraftReceiver />);

    let ok = false;
    act(() => {
      ok = draftToMainComposer('please fix X');
    });

    expect(ok).toBe(true);
    expect(mocks.editor.setDocument).toHaveBeenCalledWith('markdown', 'please fix X');
    // P1 regression: setDocument alone leaves Send disabled — inputMessage must sync.
    expect(mocks.updateInputMessage).toHaveBeenCalledWith('please fix X');
    expect(mocks.editor.focus).toHaveBeenCalled();
    expect(useComposerDraftBus.getState().draft).toBeNull();
  });

  it('stays detached without an editor, so posting reports failure', () => {
    render(<ComposerDraftReceiver />);
    expect(useComposerDraftBus.getState().attached).toBe(false);
    expect(draftToMainComposer('text')).toBe(false);
  });
});
