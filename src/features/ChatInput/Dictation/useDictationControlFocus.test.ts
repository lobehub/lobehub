import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeDictationStatus } from './contract';
import { useDictationControlFocus } from './useDictationControlFocus';

const mountControl = (ref: RefObject<HTMLButtonElement | null>) => {
  const control = document.createElement('button');
  control.tabIndex = 0;
  document.body.append(control);
  ref.current = control;

  return control;
};

const unmountControl = (ref: RefObject<HTMLButtonElement | null>) => {
  ref.current?.remove();
  ref.current = null;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useDictationControlFocus', () => {
  it('activates controls with Enter and Space while rejecting repeats and unrelated keys', () => {
    const { result } = renderHook(() =>
      useDictationControlFocus({ active: false, retryable: false, status: 'idle' }),
    );
    const activate = vi.fn();
    const preventDefault = vi.fn();

    act(() =>
      result.current.handleKeyboardActivation(
        { key: 'Enter', preventDefault, repeat: false },
        activate,
      ),
    );
    act(() =>
      result.current.handleKeyboardActivation(
        { key: ' ', preventDefault, repeat: false },
        activate,
      ),
    );
    act(() =>
      result.current.handleKeyboardActivation(
        { key: 'Escape', preventDefault, repeat: false },
        activate,
      ),
    );
    act(() =>
      result.current.handleKeyboardActivation(
        { key: 'Enter', preventDefault, repeat: true },
        activate,
      ),
    );

    expect(activate).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it('keeps keyboard focus within the controls across the dictation lifecycle', () => {
    const { rerender, result } = renderHook(
      ({
        active,
        retryable,
        status,
      }: {
        active: boolean;
        retryable: boolean;
        status: RealtimeDictationStatus;
      }) => useDictationControlFocus({ active, retryable, status }),
      {
        initialProps: {
          active: false,
          retryable: false,
          status: 'idle' as RealtimeDictationStatus,
        },
      },
    );
    const action = mountControl(result.current.actionRef);
    action.focus();

    act(() => result.current.preserveFocusOnActivation({ detail: 0 }));
    unmountControl(result.current.actionRef);
    const connectingCancel = mountControl(result.current.cancelRef);
    rerender({ active: true, retryable: false, status: 'requesting_permission' });
    expect(document.activeElement).toBe(connectingCancel);

    unmountControl(result.current.cancelRef);
    const stop = mountControl(result.current.stopRef);
    mountControl(result.current.cancelRef);
    rerender({ active: true, retryable: false, status: 'listening' });
    expect(document.activeElement).toBe(stop);

    unmountControl(result.current.stopRef);
    rerender({ active: true, retryable: false, status: 'finalizing' });
    expect(document.activeElement).toBe(result.current.cancelRef.current);

    unmountControl(result.current.cancelRef);
    const restoredAction = mountControl(result.current.actionRef);
    rerender({ active: false, retryable: false, status: 'idle' });
    expect(document.activeElement).toBe(restoredAction);
  });

  it('does not force focus transfer for pointer activation', () => {
    const { rerender, result } = renderHook(
      ({ active, status }: { active: boolean; status: RealtimeDictationStatus }) =>
        useDictationControlFocus({ active, retryable: false, status }),
      { initialProps: { active: false, status: 'idle' as RealtimeDictationStatus } },
    );
    const action = mountControl(result.current.actionRef);
    action.focus();

    act(() => result.current.preserveFocusOnActivation({ detail: 1 }));
    unmountControl(result.current.actionRef);
    const cancel = mountControl(result.current.cancelRef);
    rerender({ active: true, status: 'connecting' });

    expect(document.activeElement).not.toBe(cancel);
  });

  it('does not steal focus after the user moves outside the dictation controls', () => {
    const { rerender, result } = renderHook(
      ({ active, status }: { active: boolean; status: RealtimeDictationStatus }) =>
        useDictationControlFocus({ active, retryable: false, status }),
      { initialProps: { active: false, status: 'idle' as RealtimeDictationStatus } },
    );
    const action = mountControl(result.current.actionRef);
    action.focus();

    act(() => result.current.preserveFocusOnActivation({ detail: 0 }));
    unmountControl(result.current.actionRef);
    mountControl(result.current.cancelRef);
    rerender({ active: true, status: 'connecting' });

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    unmountControl(result.current.cancelRef);
    const stop = mountControl(result.current.stopRef);
    mountControl(result.current.cancelRef);
    rerender({ active: true, status: 'listening' });

    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(stop);
  });

  it('keeps focus managed while idle status exits the active control row', () => {
    const { rerender, result } = renderHook(
      ({ active }: { active: boolean }) =>
        useDictationControlFocus({ active, retryable: false, status: 'idle' }),
      { initialProps: { active: true } },
    );
    const cancel = mountControl(result.current.cancelRef);
    cancel.focus();

    act(() =>
      result.current.handleKeyboardActivation(
        { key: 'Enter', preventDefault: vi.fn(), repeat: false },
        vi.fn(),
      ),
    );
    rerender({ active: true });
    expect(document.activeElement).toBe(cancel);

    unmountControl(result.current.cancelRef);
    const action = mountControl(result.current.actionRef);
    rerender({ active: false });

    expect(document.activeElement).toBe(action);
  });

  it('preserves keyboard focus across the idle transition before permission is requested', () => {
    const { rerender, result } = renderHook(
      ({ active, status }: { active: boolean; status: RealtimeDictationStatus }) =>
        useDictationControlFocus({ active, retryable: false, status }),
      { initialProps: { active: false, status: 'idle' as RealtimeDictationStatus } },
    );
    const action = mountControl(result.current.actionRef);
    action.focus();

    act(() =>
      result.current.handleKeyboardActivation(
        { key: 'Enter', preventDefault: vi.fn(), repeat: false },
        vi.fn(),
      ),
    );

    unmountControl(result.current.actionRef);
    const pendingCancel = mountControl(result.current.cancelRef);
    rerender({ active: true, status: 'idle' });
    expect(document.activeElement).toBe(pendingCancel);

    unmountControl(result.current.cancelRef);
    const pendingAction = mountControl(result.current.actionRef);
    rerender({ active: false, status: 'idle' });
    expect(document.activeElement).toBe(pendingAction);

    unmountControl(result.current.actionRef);
    const permissionCancel = mountControl(result.current.cancelRef);
    rerender({ active: true, status: 'requesting_permission' });

    expect(document.activeElement).toBe(permissionCancel);
  });
});
