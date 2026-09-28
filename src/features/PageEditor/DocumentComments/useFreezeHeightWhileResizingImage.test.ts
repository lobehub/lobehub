import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFreezeHeightWhileResizingImage } from './useFreezeHeightWhileResizingImage';

const mount = () => {
  const root = document.createElement('div');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const container = document.createElement('div');
  const img = document.createElement('img');
  const handle = document.createElement('div');
  handle.style.cursor = 'col-resize';
  container.append(img, handle);
  editable.append(container);
  root.append(editable);
  document.body.append(root);
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ height: 180 } as DOMRect);
  return { handle, img, root };
};

const mouse = (type: string) => new MouseEvent(type, { bubbles: true });

describe('useFreezeHeightWhileResizingImage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('locks the wrapper height while an image handle is dragged and releases on mouseup', () => {
    const { handle, root } = mount();
    const { result } = renderHook(() => useFreezeHeightWhileResizingImage());
    act(() => result.current(root));

    handle.dispatchEvent(mouse('mousedown'));
    expect(root.style.height).toBe('180px');
    expect(root.style.overflow).toBe('hidden');

    document.dispatchEvent(mouse('mouseup'));
    expect(root.style.height).toBe('');
    expect(root.style.overflow).toBe('');
  });

  it('ignores mousedown on anything that is not a resize handle', () => {
    const { img, root } = mount();
    const { result } = renderHook(() => useFreezeHeightWhileResizingImage());
    act(() => result.current(root));

    img.dispatchEvent(mouse('mousedown'));
    expect(root.style.height).toBe('');

    const text = document.createElement('div');
    text.style.cursor = 'col-resize';
    root.append(text);
    text.dispatchEvent(mouse('mousedown'));
    expect(root.style.height).toBe('');
  });

  it('releases a pending lock when the editor unmounts mid-drag', () => {
    const { handle, root } = mount();
    const { result, unmount } = renderHook(() => useFreezeHeightWhileResizingImage());
    act(() => result.current(root));

    handle.dispatchEvent(mouse('mousedown'));
    expect(root.style.height).toBe('180px');

    unmount();
    expect(root.style.height).toBe('');
    expect(root.style.overflow).toBe('');
  });
});
