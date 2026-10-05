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
  context: { agentId: 'agt_inbox', topicId: undefined as string | undefined },
  inputMessage: '',
  updateInputMessage: vi.fn(),
}));

vi.mock('./store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) =>
    selector({
      context: mocks.context,
      editor: mocks.editor,
      updateInputMessage: mocks.updateInputMessage,
    }),
  useConversationStoreApi: () => ({ getState: () => ({ inputMessage: mocks.inputMessage }) }),
}));

describe('ComposerDraftReceiver', () => {
  beforeEach(() => {
    useComposerDraftBus.setState({ attached: false, draft: null });
    mocks.editor = null;
    mocks.inputMessage = '';
    mocks.context = { agentId: 'agt_inbox', topicId: undefined };
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

  // Regression: appending trimmed the typed text, losing a trailing Markdown break.
  it('keeps the whitespace of what the user typed when appending', () => {
    mocks.editor = { focus: vi.fn(), setDocument: vi.fn() };
    mocks.inputMessage = '  indented line  ';
    render(<ComposerDraftReceiver />);

    act(() => {
      draftToMainComposer('1. note', { append: true });
    });

    expect(mocks.editor.setDocument).toHaveBeenCalledWith(
      'markdown',
      '  indented line  \n\n1. note',
    );
  });

  it('applies a queued draft once a composer mounts', () => {
    queueDraftForMainComposer('queued before navigation', { agentId: 'agt_inbox' });
    mocks.editor = { focus: vi.fn(), setDocument: vi.fn() };
    render(<ComposerDraftReceiver />);

    expect(mocks.editor.setDocument).toHaveBeenCalledWith('markdown', 'queued before navigation');
    expect(useComposerDraftBus.getState().draft).toBeNull();
  });

  // Regression: right after navigating, the conversation is still on the
  // previously active topic; the switch to the new topic clears the input.
  it('holds a queued draft until the conversation reaches the target new topic', () => {
    queueDraftForMainComposer('queued before navigation', { agentId: 'agt_inbox' });
    mocks.editor = { focus: vi.fn(), setDocument: vi.fn() };
    mocks.context = { agentId: 'agt_inbox', topicId: 'tpc_previous' };
    const { rerender } = render(<ComposerDraftReceiver />);

    expect(mocks.editor.setDocument).not.toHaveBeenCalled();
    expect(useComposerDraftBus.getState().draft).not.toBeNull();

    // The mocked store is not reactive; a fresh render stands in for its update.
    mocks.context = { agentId: 'agt_inbox', topicId: undefined };
    rerender(<ComposerDraftReceiver key={'settled'} />);

    expect(mocks.editor.setDocument).toHaveBeenCalledWith('markdown', 'queued before navigation');
  });

  it('stays detached without an editor, so posting reports failure', () => {
    render(<ComposerDraftReceiver />);
    expect(useComposerDraftBus.getState().attached).toBe(false);
    expect(draftToMainComposer('text')).toBe(false);
  });
});
