import type { IEditor } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  focusEditorFirstLine,
  focusEditorStartLine,
} from '@/features/EditorCanvas/focusEditorStartLine';

import { createStore, Provider } from './store';
import { PAGE_TITLE_INPUT_ATTRIBUTE } from './titleBodyNavigation';
import {
  holdTitleFocus,
  isUnstartedPage,
  splitTitleAtSelection,
  usePageTitleInteractions,
} from './usePageTitleInteractions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/EditorCanvas/focusEditorStartLine', async (importOriginal) => ({
  // Keep the real readiness check; only the caret moves are spied on.
  ...(await importOriginal<Record<string, unknown>>()),
  focusEditorFirstLine: vi.fn(),
  focusEditorStartLine: vi.fn(),
}));

const mockEditable = { current: true };
vi.mock('./usePageEditable', () => ({
  usePageEditable: () => mockEditable.current,
}));

const mockDocumentState: { current: { documents: Record<string, { content: string }> } } = {
  current: { documents: {} },
};
vi.mock('@/store/document', () => ({
  useDocumentStore: Object.assign((selector: any) => selector(mockDocumentState.current), {
    getState: () => ({ performSave: vi.fn() }),
  }),
}));
vi.mock('@/store/document/slices/editor', () => ({
  editorSelectors: {
    content: (id: string) => (s: any) => s.documents[id]?.content ?? '',
    isDocumentLoading: (id: string | undefined) => (s: any) => !id || !s.documents[id],
  },
}));

/** Whether the body editor is mounted and editable (its content request resolved). */
const mockBodyMounted = { current: true };
const editor = {
  focus: vi.fn(),
  getLexicalEditor: () =>
    mockBodyMounted.current
      ? { getRootElement: () => document.body, isEditable: () => true }
      : null,
} as unknown as IEditor;

const setup = ({
  content = 'Some body',
  documentLoaded = true,
  metaReadOnly = false,
  title: titleOption = 'My page',
  titleUnknown = false,
}: {
  content?: string;
  documentLoaded?: boolean;
  metaReadOnly?: boolean;
  title?: string;
  /** The page's title has not arrived yet (store title `undefined`). */
  titleUnknown?: boolean;
} = {}) => {
  const title = titleUnknown ? undefined : titleOption;
  mockDocumentState.current = { documents: documentLoaded ? { 'doc-1': { content } } : {} };

  const container = document.createElement('div');
  const input = document.createElement('textarea');
  input.setAttribute(PAGE_TITLE_INPUT_ATTRIBUTE, 'true');
  input.value = title ?? '';
  container.append(input);
  document.body.append(container);

  const store = createStore({ documentId: 'doc-1', editor, metaReadOnly, title });
  const flushMetaSave = vi.fn();
  store.setState({ flushMetaSave });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { createStore: () => store }, children);
  const { rerender, result } = renderHook(() => usePageTitleInteractions({ current: container }), {
    wrapper,
  });

  return { flushMetaSave, input, rerender, result, store };
};

/** Let focus events and the hold's deferred check run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

const createButton = () => {
  const button = document.createElement('button');
  document.body.append(button);
  return button;
};

const keyDown = (
  input: HTMLTextAreaElement,
  init: { isComposing?: boolean; key: string; keyCode?: number; shiftKey?: boolean },
) => {
  const preventDefault = vi.fn();
  const event = {
    altKey: false,
    ctrlKey: false,
    currentTarget: input,
    key: init.key,
    keyCode: init.keyCode ?? 0,
    metaKey: false,
    nativeEvent: { isComposing: init.isComposing ?? false },
    preventDefault,
    shiftKey: init.shiftKey ?? false,
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
  return { event, preventDefault };
};

beforeEach(() => {
  mockEditable.current = true;
  mockBodyMounted.current = true;
  vi.mocked(focusEditorFirstLine).mockClear();
  vi.mocked(focusEditorStartLine).mockClear();
});

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = '';
});

describe('usePageTitleInteractions — Enter', () => {
  it('splits the title at the caret and carries the rest into the body', () => {
    const { input, result, store } = setup({ title: 'Hello world' });
    input.setSelectionRange(5, 5);
    const { event, preventDefault } = keyDown(input, { key: 'Enter', keyCode: 13 });

    act(() => result.current.handleTitleKeyDown(event));

    expect(preventDefault).toHaveBeenCalled();
    expect(store.getState().title).toBe('Hello');
    expect(focusEditorStartLine).toHaveBeenCalledWith(editor, ' world');
  });

  it('opens the first body line from the end of the title, keeping the title', () => {
    const { input, result, store } = setup({ title: 'Hello' });
    input.setSelectionRange(5, 5);

    act(() => result.current.handleTitleKeyDown(keyDown(input, { key: 'Enter' }).event));

    expect(store.getState().title).toBe('Hello');
    expect(focusEditorStartLine).toHaveBeenCalledWith(editor, '');
  });

  it('leaves an Enter that confirms an IME candidate alone', () => {
    const { input, result } = setup({ title: 'Hello' });

    act(() =>
      result.current.handleTitleKeyDown(keyDown(input, { key: 'Enter', keyCode: 229 }).event),
    );

    expect(focusEditorStartLine).not.toHaveBeenCalled();
  });

  it('does not split a title that cannot be edited', () => {
    const { input, result, store } = setup({ metaReadOnly: true, title: 'Hello world' });
    input.setSelectionRange(5, 5);

    act(() => result.current.handleTitleKeyDown(keyDown(input, { key: 'Enter' }).event));

    expect(store.getState().title).toBe('Hello world');
    expect(focusEditorStartLine).not.toHaveBeenCalled();
  });
});

describe('usePageTitleInteractions — Enter before the body is ready', () => {
  it.each([
    ['the body editor is not mounted yet', { bodyMounted: false, documentLoaded: true }],
    ['the document is still loading', { bodyMounted: true, documentLoaded: false }],
  ])('keeps the whole title and only saves it while %s', (_, { bodyMounted, documentLoaded }) => {
    mockBodyMounted.current = bodyMounted;
    const { flushMetaSave, input, result, store } = setup({
      documentLoaded,
      title: 'Hello world',
    });
    input.setSelectionRange(5, 5);
    const { event, preventDefault } = keyDown(input, { key: 'Enter', keyCode: 13 });

    act(() => result.current.handleTitleKeyDown(event));

    // No line break goes into the title, and nothing of it is lost.
    expect(preventDefault).toHaveBeenCalled();
    expect(store.getState().title).toBe('Hello world');
    expect(flushMetaSave).toHaveBeenCalledTimes(1);
    expect(focusEditorStartLine).not.toHaveBeenCalled();
  });

  it('leaves ArrowDown to the browser until the body is mounted', () => {
    mockBodyMounted.current = false;
    const { input, result } = setup({ title: 'Hello' });
    const { event, preventDefault } = keyDown(input, { key: 'ArrowDown' });

    act(() => result.current.handleTitleKeyDown(event));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(focusEditorFirstLine).not.toHaveBeenCalled();
  });
});

describe('usePageTitleInteractions — ArrowDown', () => {
  it('moves into the body from a one-line title', () => {
    const { input, result } = setup({ title: 'Hello' });
    input.setSelectionRange(2, 2);
    const { event, preventDefault } = keyDown(input, { key: 'ArrowDown' });

    act(() => result.current.handleTitleKeyDown(event));

    expect(preventDefault).toHaveBeenCalled();
    expect(focusEditorFirstLine).toHaveBeenCalledWith(editor);
  });

  it('still moves into an editable body when only the title is read-only', () => {
    const { input, result } = setup({ metaReadOnly: true, title: 'SKILL.md' });

    act(() => result.current.handleTitleKeyDown(keyDown(input, { key: 'ArrowDown' }).event));

    expect(focusEditorFirstLine).toHaveBeenCalledWith(editor);
  });

  it('keeps Shift+ArrowDown for selecting', () => {
    const { input, result } = setup({ title: 'Hello' });

    act(() =>
      result.current.handleTitleKeyDown(keyDown(input, { key: 'ArrowDown', shiftKey: true }).event),
    );

    expect(focusEditorFirstLine).not.toHaveBeenCalled();
  });
});

describe('usePageTitleInteractions — line breaks', () => {
  it('turns a pasted line break into a space', () => {
    const { input, result, store } = setup({ title: '' });
    input.value = 'Line one\nLine two';

    act(() =>
      result.current.handleTitleChange({
        target: input,
      } as unknown as ChangeEvent<HTMLTextAreaElement>),
    );

    expect(store.getState().title).toBe('Line one Line two');
  });
});

describe('usePageTitleInteractions — icon', () => {
  it('previews the default icon while picking but saves only a picked one', () => {
    const { result, store } = setup();

    act(() => result.current.emojiPicker.onOpen());
    expect(result.current.emojiPicker).toMatchObject({ open: true, value: '📄', visible: true });
    expect(store.getState().emoji).toBeUndefined();

    act(() => result.current.emojiPicker.onOpenChange(false));
    expect(result.current.emojiPicker).toMatchObject({ open: false, visible: false });
    expect(store.getState().emoji).toBeUndefined();

    act(() => result.current.emojiPicker.onOpen());
    act(() => result.current.emojiPicker.onChange('🎉'));
    expect(store.getState().emoji).toBe('🎉');
    expect(result.current.emojiPicker).toMatchObject({ open: false, value: '🎉', visible: true });
  });
});

describe('usePageTitleInteractions — opening a new page', () => {
  it('focuses and selects the default title of an unstarted page', () => {
    const { input } = setup({ content: '', title: 'Untitled' });

    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Untitled'.length]);
  });

  it('leaves a page that already has a body alone', () => {
    const { input } = setup({ content: 'Started', title: 'Untitled' });

    expect(document.activeElement).not.toBe(input);
  });

  it('leaves a named page alone', () => {
    const { input } = setup({ content: '', title: 'Plans' });

    expect(document.activeElement).not.toBe(input);
  });

  it('does not take the keyboard from another field', () => {
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();

    setup({ content: '', title: 'Untitled' });

    expect(document.activeElement).toBe(other);
  });

  // The sidebar's "New page" entry closes its menu after the page opens, and
  // the menu hands focus back to the button it was opened from.
  it('takes the title back when focus is handed to the button it was opened from', async () => {
    const { input } = setup({ content: '', title: 'Untitled' });

    createButton().focus();
    await settle();

    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Untitled'.length]);
  });

  it('lets the user move the focus away', async () => {
    setup({ content: '', title: 'Untitled' });
    const button = createButton();

    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    button.focus();
    await settle();

    expect(document.activeElement).toBe(button);
  });

  it('takes the title from a field that focused itself after the page opened', async () => {
    const { input, rerender } = setup({ content: '', documentLoaded: false, title: 'Untitled' });
    // A side panel auto-focuses its input while the page is still loading.
    const panelInput = document.createElement('input');
    document.body.append(panelInput);
    panelInput.focus();

    mockDocumentState.current = { documents: { 'doc-1': { content: '' } } };
    rerender();
    await settle();

    expect(document.activeElement).toBe(input);
  });

  it('decides only once the title has arrived', async () => {
    const { input, store } = setup({ content: '', titleUnknown: true });
    expect(document.activeElement).not.toBe(input);

    input.value = 'Untitled';
    act(() => store.getState().initMeta('Untitled'));
    await settle();

    expect(document.activeElement).toBe(input);
  });
});

describe('holdTitleFocus', () => {
  it('stops holding the title after a moment', async () => {
    const input = document.createElement('textarea');
    document.body.append(input);
    const open = { documentId: 'doc-1', focusedAtOpen: null, interacted: false };

    holdTitleFocus(input, open, 1);
    expect(document.activeElement).toBe(input);
    await settle();

    const button = createButton();
    button.focus();
    await settle();

    expect(document.activeElement).toBe(button);
  });
});

describe('splitTitleAtSelection', () => {
  it('drops the selected text and splits around it', () => {
    expect(splitTitleAtSelection('Hello big world', 6, 9)).toEqual({
      body: ' world',
      title: 'Hello ',
    });
  });
});

describe('isUnstartedPage', () => {
  it('recognises the default title in the current language or English', () => {
    expect(isUnstartedPage('无标题', '', '无标题')).toBe(true);
    expect(isUnstartedPage('Untitled', '  ', '无标题')).toBe(true);
    expect(isUnstartedPage('Untitled', 'body', '无标题')).toBe(false);
    expect(isUnstartedPage('Plans', '', '无标题')).toBe(false);
    expect(isUnstartedPage(undefined, '', '无标题')).toBe(false);
  });
});
