/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TASK_FILTER_CONTENT_COMMIT_DELAY_MS, useTaskListFind } from './useTaskListFind';

const setup = (content?: string) => {
  const onChange = vi.fn();
  const hook = renderHook(
    ({ value }: { value?: string }) => useTaskListFind({ content: value, onChange }),
    { initialProps: { value: content } },
  );
  return { ...hook, onChange };
};

describe('useTaskListFind', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts collapsed with no text condition, and Mod+F opens it with a focus request', () => {
    const { result } = setup();
    expect(result.current.expanded).toBe(false);

    act(() => result.current.openFind());

    expect(result.current.expanded).toBe(true);
    expect(result.current.focusRequest).toBe(1);

    // A repeat press asks to re-select the text.
    act(() => result.current.openFind());
    expect(result.current.focusRequest).toBe(2);
  });

  it('commits the typed text after the pause, not on every keystroke', () => {
    const { result, onChange } = setup();
    act(() => result.current.openFind());

    act(() => result.current.setDraft('dep'));
    act(() => result.current.setDraft('deploy'));
    act(() => {
      vi.advanceTimersByTime(TASK_FILTER_CONTENT_COMMIT_DELAY_MS - 1);
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('deploy');
  });

  it('commits at once on Enter', () => {
    const { result, onChange } = setup();
    act(() => result.current.setDraft('T-12'));

    act(() => result.current.commit());

    expect(onChange).toHaveBeenCalledWith('T-12');
  });

  it('shows an active text condition in the box', () => {
    const { result } = setup('billing');

    expect(result.current.expanded).toBe(true);
    expect(result.current.draft).toBe('billing');
  });

  it('clears the condition and closes on Escape without re-committing on the blur that follows', () => {
    const { result, rerender, onChange } = setup('billing');

    act(() => result.current.clearAndClose());
    act(() => result.current.blur());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('');

    rerender({ value: undefined });
    expect(result.current.expanded).toBe(false);
    expect(result.current.draft).toBe('');
  });

  it('closes an empty box on blur and keeps one holding text', () => {
    const { result } = setup();
    act(() => result.current.openFind());
    act(() => result.current.blur());
    expect(result.current.expanded).toBe(false);

    act(() => result.current.openFind());
    act(() => result.current.setDraft('deploy'));
    act(() => result.current.blur());
    expect(result.current.expanded).toBe(true);
  });

  it('follows a condition changed elsewhere, but keeps a trailing space being typed', () => {
    const { result, rerender } = setup('deploy');

    act(() => result.current.setDraft('deploy '));
    rerender({ value: 'deploy' });
    expect(result.current.draft).toBe('deploy ');

    // The filter menu replaced the condition.
    rerender({ value: 'billing' });
    expect(result.current.draft).toBe('billing');
  });

  it('keeps a box shown for an existing condition open while its text is erased and retyped', () => {
    const { result, rerender } = setup('deploy');

    act(() => result.current.focus());
    act(() => result.current.setDraft(''));
    // The empty text is committed after the pause; the focused box must stay.
    rerender({ value: undefined });

    expect(result.current.expanded).toBe(true);
  });

  it('closes an unfocused open box when its condition is cleared elsewhere', () => {
    const { result, rerender } = setup();
    act(() => result.current.openFind());
    act(() => result.current.setDraft('deploy'));
    rerender({ value: 'deploy' });
    act(() => result.current.blur());
    expect(result.current.expanded).toBe(true);

    // "Clear all" in the empty state.
    rerender({ value: undefined });

    expect(result.current.expanded).toBe(false);
  });
});
