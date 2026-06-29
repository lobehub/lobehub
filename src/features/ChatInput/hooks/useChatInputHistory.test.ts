import type { IEditor } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addInputHistory } from '../inputHistoryStorage';
import {
  createInputHistoryNavigator,
  shouldIgnoreInputHistoryKeyDown,
  useChatInputHistory,
} from './useChatInputHistory';

const createKeyDownEvent = (key: string, init?: KeyboardEventInit) =>
  new KeyboardEvent('keydown', { key, ...init });

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

describe('createInputHistoryNavigator', () => {
  it('does not enter history mode when the editor already has input', () => {
    const applyEntry = vi.fn();
    const navigator = createInputHistoryNavigator({
      applyEntry,
      clearInput: vi.fn(),
      getEntries: () => [{ createdAt: 1, markdown: 'previous prompt' }],
      getMarkdownContent: () => 'line 1\nline 2',
    });

    expect(navigator.handleKeyDown(createKeyDownEvent('ArrowUp'))).toBe(false);
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('navigates older and newer entries after starting from an empty input', () => {
    const applyEntry = vi.fn();
    const clearInput = vi.fn();
    const navigator = createInputHistoryNavigator({
      applyEntry,
      clearInput,
      getEntries: () => [
        { createdAt: 3, markdown: 'third prompt' },
        { createdAt: 2, markdown: 'second prompt' },
        { createdAt: 1, markdown: 'first prompt' },
      ],
      getMarkdownContent: () => '',
    });

    expect(navigator.handleKeyDown(createKeyDownEvent('ArrowUp'))).toBe(true);
    expect(applyEntry).toHaveBeenLastCalledWith({ createdAt: 3, markdown: 'third prompt' });

    expect(navigator.handleKeyDown(createKeyDownEvent('ArrowUp'))).toBe(true);
    expect(applyEntry).toHaveBeenLastCalledWith({ createdAt: 2, markdown: 'second prompt' });

    expect(navigator.handleKeyDown(createKeyDownEvent('ArrowDown'))).toBe(true);
    expect(applyEntry).toHaveBeenLastCalledWith({ createdAt: 3, markdown: 'third prompt' });

    expect(navigator.handleKeyDown(createKeyDownEvent('ArrowDown'))).toBe(true);
    expect(clearInput).toHaveBeenCalledTimes(1);
  });

  it('resets history mode on unrelated keys', () => {
    const applyEntry = vi.fn();
    const clearInput = vi.fn();
    const navigator = createInputHistoryNavigator({
      applyEntry,
      clearInput,
      getEntries: () => [{ createdAt: 1, markdown: 'previous prompt' }],
      getMarkdownContent: () => '',
    });

    expect(navigator.handleKeyDown(createKeyDownEvent('ArrowUp'))).toBe(true);
    expect(navigator.handleKeyDown(createKeyDownEvent('a'))).toBe(false);
    expect(navigator.handleKeyDown(createKeyDownEvent('ArrowDown'))).toBe(false);
    expect(clearInput).not.toHaveBeenCalled();
  });
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
  it('keeps editor focus after restoring and clearing history entries', () => {
    const editorData = { root: { children: [{ text: 'previous prompt' }] } };
    addInputHistory({ json: editorData, markdown: 'previous prompt' });

    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      setDocument: vi.fn(),
    } as unknown as IEditor;
    const isComposingRef = { current: false };

    const { result } = renderHook(() =>
      useChatInputHistory({
        editor,
        enabled: true,
        getMarkdownContent: () => '',
        isComposingRef,
      }),
    );

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowUp'));
    });

    expect(editor.setDocument).toHaveBeenCalledWith('json', editorData, { keepHistory: true });
    expect(editor.focus).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleKeyDown(createKeyDownEvent('ArrowDown'));
    });

    expect(editor.cleanDocument).toHaveBeenCalledTimes(1);
    expect(editor.focus).toHaveBeenCalledTimes(2);
  });
});
