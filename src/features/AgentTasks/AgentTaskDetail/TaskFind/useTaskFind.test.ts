/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTaskFind } from './useTaskFind';

const mount = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useTaskFind', () => {
  it('counts matches in the instruction editor and the rest of the detail', () => {
    const root = mount(
      '<div contenteditable="true"><p>Fix the drive menu</p></div><p>drive acceptance</p><textarea>drive</textarea>',
    );

    const { result } = renderHook(() => useTaskFind({ enabled: true, keyword: 'Drive', root }));

    expect(result.current.count).toBe(2);
    expect(result.current.activeIndex).toBe(0);
  });

  it('steps through matches and wraps around in both directions', () => {
    const root = mount('<p>a x b x c x</p>');
    const { result } = renderHook(() => useTaskFind({ enabled: true, keyword: 'x', root }));

    act(() => result.current.step(1));
    act(() => result.current.step(1));
    expect(result.current.activeIndex).toBe(2);
    act(() => result.current.step(1));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.step(-1));
    expect(result.current.activeIndex).toBe(2);
  });

  it('finds nothing while closed or with a blank keyword', () => {
    const root = mount('<p>drive</p>');

    const closed = renderHook(() => useTaskFind({ enabled: false, keyword: 'drive', root }));
    const blank = renderHook(() => useTaskFind({ enabled: true, keyword: '  ', root }));

    expect(closed.result.current.count).toBe(0);
    expect(blank.result.current.count).toBe(0);
  });

  it('recounts when the detail re-renders and keeps the position in range', async () => {
    const root = mount('<p id="a">drive drive</p><p id="b">drive</p>');
    const { result } = renderHook(() => useTaskFind({ enabled: true, keyword: 'drive', root }));

    act(() => result.current.step(-1));
    expect(result.current.activeIndex).toBe(2);

    act(() => {
      root.querySelector('#b')!.remove();
    });

    await waitFor(() => expect(result.current.count).toBe(2));
    expect(result.current.activeIndex).toBe(1);
  });

  it('restarts at the first match when the keyword changes', () => {
    const root = mount('<p>drive menu drive menu</p>');
    const { rerender, result } = renderHook(
      ({ keyword }) => useTaskFind({ enabled: true, keyword, root }),
      { initialProps: { keyword: 'drive' } },
    );

    act(() => result.current.step(1));
    expect(result.current.activeIndex).toBe(1);

    rerender({ keyword: 'menu' });
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.count).toBe(2);
  });

  it('follows a remounted container instead of the one it replaced', () => {
    const first = mount('<p>drive</p>');
    const { rerender, result } = renderHook(
      ({ root }) => useTaskFind({ enabled: true, keyword: 'drive', root }),
      { initialProps: { root: first as HTMLElement | null } },
    );
    expect(result.current.count).toBe(1);

    // Retry after a failed load: the error view unmounts the old container…
    first.remove();
    rerender({ root: null });
    expect(result.current.count).toBe(0);

    // …and a fresh one mounts with the loaded task.
    rerender({ root: mount('<p>drive here, drive there</p>') });
    expect(result.current.count).toBe(2);
  });
});
