/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFoldableComposer } from './useFoldableComposer';

const setup = () => {
  const input = { focus: vi.fn() };
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const hook = renderHook(() => useFoldableComposer(input));
  hook.result.current.triggerRef.current = trigger;
  return { hook, input, trigger };
};

describe('useFoldableComposer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts folded without focusing anything', () => {
    const { hook, input, trigger } = setup();

    expect(hook.result.current.expanded).toBe(false);
    expect(input.focus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('focuses the input once opened', () => {
    const { hook, input } = setup();

    act(() => hook.result.current.open());

    expect(hook.result.current.expanded).toBe(true);
    expect(input.focus).toHaveBeenCalledTimes(1);
  });

  it('hands focus back to the trigger when folded from the keyboard', () => {
    const { hook, trigger } = setup();
    act(() => hook.result.current.open());

    act(() => hook.result.current.fold(true));

    expect(hook.result.current.expanded).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the hand-back when the hidden input blurs and folds again', () => {
    const { hook, trigger } = setup();
    act(() => hook.result.current.open());

    act(() => {
      hook.result.current.fold(true);
      hook.result.current.fold();
    });

    expect(document.activeElement).toBe(trigger);
  });

  it('leaves focus alone when folded by clicking away', () => {
    const { hook, trigger } = setup();
    act(() => hook.result.current.open());

    act(() => hook.result.current.fold());

    expect(hook.result.current.expanded).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
  });
});
