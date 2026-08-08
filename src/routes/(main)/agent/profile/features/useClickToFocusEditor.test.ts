/**
 * @vitest-environment happy-dom
 */
import { type IEditor } from '@lobehub/editor';
import { renderHook } from '@testing-library/react';
import { type MouseEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClickToFocusEditor } from './useClickToFocusEditor';

const focus = vi.fn();
const getRootElement = vi.fn<() => { offsetParent: unknown } | null>();
const editor = { focus, getRootElement } as unknown as IEditor;

const clickEvent = (contains = true) =>
  ({
    currentTarget: { contains: () => contains },
    target: {},
  }) as unknown as MouseEvent<HTMLDivElement>;

describe('useClickToFocusEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('focuses the editor when its root element is visible', () => {
    getRootElement.mockReturnValue({ offsetParent: {} });
    const { result } = renderHook(() => useClickToFocusEditor(editor, true));

    result.current(clickEvent());

    expect(focus).toHaveBeenCalled();
  });

  it('does not focus the editor while its root element is hidden (source mode)', () => {
    // Lexical's focus() selects the document end when no selection exists, so
    // focusing the display:none visual editor leaves a dirty end-of-document
    // selection that scrolls the page to the bottom once the editor becomes
    // visible again.
    getRootElement.mockReturnValue({ offsetParent: null });
    const { result } = renderHook(() => useClickToFocusEditor(editor, true));

    result.current(clickEvent());

    expect(focus).not.toHaveBeenCalled();
  });

  it('still focuses when the root element is not resolvable yet', () => {
    getRootElement.mockReturnValue(null);
    const { result } = renderHook(() => useClickToFocusEditor(editor, true));

    result.current(clickEvent());

    expect(focus).toHaveBeenCalled();
  });

  it('ignores clicks bubbling from portal content outside the wrapper', () => {
    getRootElement.mockReturnValue({ offsetParent: {} });
    const { result } = renderHook(() => useClickToFocusEditor(editor, true));

    result.current(clickEvent(false));

    expect(focus).not.toHaveBeenCalled();
  });

  it('skips focus entirely without edit permission', () => {
    getRootElement.mockReturnValue({ offsetParent: {} });
    const { result } = renderHook(() => useClickToFocusEditor(editor, false));

    result.current(clickEvent());

    expect(focus).not.toHaveBeenCalled();
  });
});
