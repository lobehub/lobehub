import type { IEditor } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addInputHistory } from '../inputHistoryStorage';
import { shouldIgnoreInputHistoryKeyDown, useChatInputHistory } from './useChatInputHistory';

const createKeyDownEvent = (key: string, init?: KeyboardEventInit) =>
  new KeyboardEvent('keydown', { key, ...init });

const createEditorMock = (onSetDocument?: (type: string, value: unknown) => void) =>
  ({
    cleanDocument: vi.fn(),
    focus: vi.fn(),
    setDocument: vi.fn((type: string, value: unknown) => onSetDocument?.(type, value)),
  }) as unknown as IEditor;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shouldIgnoreInputHistoryKeyDown', () => {
  it('ignores composing and modified keyboard events', () => {
    expect(
      shouldIgnoreInputHistoryKeyDown(createKeyDownEvent('ArrowUp', { altKey: true }), false),
    ).toBe(true);
    expect(
      shouldIgnoreInputHistoryKeyDown(createKeyDownEvent('ArrowUp', { metaKey: true }), false),
    ).toBe(true);
    expect(
      shouldIgnoreInputHistoryKeyDown(createKeyDownEvent('ArrowUp', { shiftKey: true }), false),
    ).toBe(true);
    expect(shouldIgnoreInputHistoryKeyDown(createKeyDownEvent('ArrowUp'), true)).toBe(true);
  });

  it('ignores events that another editor plugin already consumed', () => {
    const event = createKeyDownEvent('ArrowUp', { cancelable: true });
    event.preventDefault();

    expect(shouldIgnoreInputHistoryKeyDown(event, false)).toBe(true);
  });

  it('allows plain arrow key events', () => {
    expect(shouldIgnoreInputHistoryKeyDown(createKeyDownEvent('ArrowUp'), false)).toBe(false);
  });
});

describe('useChatInputHistory', () => {
  const renderHistory = (overrides: Partial<Parameters<typeof useChatInputHistory>[0]> = {}) => {
    const editor = overrides.editor ?? createEditorMock();
    const isComposingRef = { current: false };
    const view = renderHook(() =>
      useChatInputHistory({
        editor,
        enabled: true,
        getMarkdownContent: () => '',
        isComposingRef,
        ...overrides,
      }),
    );
    return { editor, ...view };
  };

  it('does not open the popup when the editor already has input', () => {
    addInputHistory({ markdown: 'previous prompt' });
    const { result } = renderHistory({ getMarkdownContent: () => 'line 1\nline 2' });

    let consumed = true;
    act(() => {
      consumed = result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });

    expect(consumed).toBe(false);
    expect(result.current.popup.open).toBe(false);
  });

  it('does not open the popup when there is no history', () => {
    const { result } = renderHistory();

    let consumed = true;
    act(() => {
      consumed = result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });

    expect(consumed).toBe(false);
    expect(result.current.popup.open).toBe(false);
  });

  it('opens the popup with a ghost preview without mutating the editor', () => {
    addInputHistory({ markdown: 'older prompt' });
    addInputHistory({ markdown: 'latest prompt' });
    const { editor, result } = renderHistory();

    act(() => {
      expect(result.current.handleKeyDown(createKeyDownEvent('ArrowUp'))).toBe(true);
    });

    expect(result.current.popup.open).toBe(true);
    expect(result.current.popup.activeIndex).toBe(0);
    expect(result.current.ghostMarkdown).toBe('latest prompt');
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it('navigates older and newer entries while the popup is open', () => {
    addInputHistory({ markdown: 'first prompt' });
    addInputHistory({ markdown: 'second prompt' });
    addInputHistory({ markdown: 'third prompt' });
    const { result } = renderHistory();

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });
    expect(result.current.ghostMarkdown).toBe('third prompt');

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });
    expect(result.current.ghostMarkdown).toBe('second prompt');

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowDown'));
    });
    expect(result.current.ghostMarkdown).toBe('third prompt');
  });

  it('closes the popup when navigating newer than the most recent entry', () => {
    addInputHistory({ markdown: 'only prompt' });
    const { editor, result } = renderHistory();

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });
    expect(result.current.popup.open).toBe(true);

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowDown'));
    });
    expect(result.current.popup.open).toBe(false);
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it('closes the popup on Escape without mutating the editor', () => {
    addInputHistory({ markdown: 'only prompt' });
    const { editor, result } = renderHistory();

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
      result.current.handleKeyDown(createKeyDownEvent('Escape'));
    });

    expect(result.current.popup.open).toBe(false);
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it('restores the highlighted entry on confirm and refocuses the editor', () => {
    addInputHistory({ markdown: 'older prompt' });
    addInputHistory({ markdown: 'latest prompt' });
    const { editor, result } = renderHistory();

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });
    act(() => {
      result.current.confirm();
    });

    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'latest prompt', {
      keepHistory: true,
    });
    expect(editor.focus).toHaveBeenCalledTimes(1);
    expect(result.current.popup.open).toBe(false);
  });

  it('confirms a hovered index via Tab', () => {
    addInputHistory({ markdown: 'older prompt' });
    addInputHistory({ markdown: 'latest prompt' });
    const { editor, result } = renderHistory();

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });
    act(() => {
      result.current.setActiveIndex(1);
    });
    expect(result.current.ghostMarkdown).toBe('older prompt');

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('Tab'));
    });

    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'older prompt', {
      keepHistory: true,
    });
    expect(result.current.popup.open).toBe(false);
  });

  it('restores saved JSON when present', () => {
    const editorData = { root: { children: [{ text: 'previous prompt' }] } };
    addInputHistory({ json: editorData, markdown: 'previous prompt' });
    const { editor, result } = renderHistory();

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });
    act(() => {
      result.current.confirm();
    });

    expect(editor.setDocument).toHaveBeenCalledWith('json', editorData, { keepHistory: true });
  });

  it('falls back to markdown when saved JSON cannot be restored', () => {
    const incompatibleEditorData = { root: { children: [{ text: 'item', type: 'list' }] } };
    addInputHistory({ json: incompatibleEditorData, markdown: '- fallback prompt' });
    const editor = createEditorMock((type) => {
      if (type === 'json') throw new Error('unknown node type');
    });
    const { result } = renderHistory({ editor });

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });
    act(() => {
      result.current.confirm();
    });

    expect(editor.setDocument).toHaveBeenNthCalledWith(1, 'json', incompatibleEditorData, {
      keepHistory: true,
    });
    expect(editor.setDocument).toHaveBeenNthCalledWith(2, 'markdown', '- fallback prompt', {
      keepHistory: true,
    });
  });

  it('reads history from the current scope only', () => {
    addInputHistory({ agentId: 'agent-1', markdown: 'scoped prompt', userId: 'user-a' });
    addInputHistory({ agentId: 'agent-2', markdown: 'other agent prompt', userId: 'user-a' });
    const { result } = renderHistory({ scope: { agentId: 'agent-1', userId: 'user-a' } });

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });

    expect(result.current.popup.entries).toHaveLength(1);
    expect(result.current.ghostMarkdown).toBe('scoped prompt');
  });

  it('does nothing when disabled', () => {
    addInputHistory({ markdown: 'previous prompt' });
    const { result } = renderHistory({ enabled: false });

    let consumed = true;
    act(() => {
      consumed = result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });

    expect(consumed).toBe(false);
    expect(result.current.popup.open).toBe(false);
  });
});
