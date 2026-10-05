import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  draftToMainComposer,
  queueDraftForMainComposer,
  useComposerDraftBus,
} from './composerDraftBus';
import ComposerDraftReceiver from './ComposerDraftReceiver';

const mocks = vi.hoisted(() => ({
  editor: null as null | { focus: ReturnType<typeof vi.fn>; setDocument: ReturnType<typeof vi.fn> },
  inputMessage: '',
  updateInputMessage: vi.fn(),
}));

vi.mock('./store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) =>
    selector({ editor: mocks.editor, updateInputMessage: mocks.updateInputMessage }),
  useConversationStoreApi: () => ({ getState: () => ({ inputMessage: mocks.inputMessage }) }),
}));

describe('ComposerDraftReceiver', () => {
  beforeEach(() => {
    useComposerDraftBus.setState({ attached: false, draft: null });
    mocks.editor = null;
    mocks.inputMessage = '';
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

  it('appends after what the user already typed when asked to', () => {
    mocks.editor = { focus: vi.fn(), setDocument: vi.fn() };
    mocks.inputMessage = 'what is wrong here?';
    render(<ComposerDraftReceiver />);

    act(() => {
      draftToMainComposer('1. top left: this logo', { append: true });
    });

    const text = 'what is wrong here?\n\n1. top left: this logo';
    expect(mocks.editor.setDocument).toHaveBeenCalledWith('markdown', text);
    expect(mocks.updateInputMessage).toHaveBeenCalledWith(text);
  });

  it('applies a queued draft once a composer mounts', () => {
    queueDraftForMainComposer('queued before navigation');
    mocks.editor = { focus: vi.fn(), setDocument: vi.fn() };
    render(<ComposerDraftReceiver />);

    expect(mocks.editor.setDocument).toHaveBeenCalledWith('markdown', 'queued before navigation');
    expect(useComposerDraftBus.getState().draft).toBeNull();
  });

  it('stays detached without an editor, so posting reports failure', () => {
    render(<ComposerDraftReceiver />);
    expect(useComposerDraftBus.getState().attached).toBe(false);
    expect(draftToMainComposer('text')).toBe(false);
  });
});
