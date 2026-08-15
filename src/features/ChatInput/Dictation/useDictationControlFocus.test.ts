import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RealtimeDictationStatus } from './contract';
import { useDictationControlFocus } from './useDictationControlFocus';

const mountControl = (ref: RefObject<HTMLDivElement | null>) => {
  const control = document.createElement('div');
  control.tabIndex = 0;
  document.body.append(control);
  ref.current = control;

  return control;
};

const unmountControl = (ref: RefObject<HTMLDivElement | null>) => {
  ref.current?.remove();
  ref.current = null;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useDictationControlFocus', () => {
  it('keeps keyboard focus within the controls across the dictation lifecycle', () => {
    const { rerender, result } = renderHook(
      ({ retryable, status }: { retryable: boolean; status: RealtimeDictationStatus }) =>
        useDictationControlFocus({ retryable, status }),
      { initialProps: { retryable: false, status: 'idle' as RealtimeDictationStatus } },
    );
    const action = mountControl(result.current.actionRef);
    action.focus();

    act(() => result.current.preserveFocusOnActivation({ detail: 0 }));
    unmountControl(result.current.actionRef);
    const connectingCancel = mountControl(result.current.cancelRef);
    rerender({ retryable: false, status: 'requesting_permission' });
    expect(document.activeElement).toBe(connectingCancel);

    unmountControl(result.current.cancelRef);
    const stop = mountControl(result.current.stopRef);
    mountControl(result.current.cancelRef);
    rerender({ retryable: false, status: 'listening' });
    expect(document.activeElement).toBe(stop);

    unmountControl(result.current.stopRef);
    rerender({ retryable: false, status: 'finalizing' });
    expect(document.activeElement).toBe(result.current.cancelRef.current);

    unmountControl(result.current.cancelRef);
    const restoredAction = mountControl(result.current.actionRef);
    rerender({ retryable: false, status: 'idle' });
    expect(document.activeElement).toBe(restoredAction);
  });

  it('does not force focus transfer for pointer activation', () => {
    const { rerender, result } = renderHook(
      ({ status }: { status: RealtimeDictationStatus }) =>
        useDictationControlFocus({ retryable: false, status }),
      { initialProps: { status: 'idle' as RealtimeDictationStatus } },
    );
    const action = mountControl(result.current.actionRef);
    action.focus();

    act(() => result.current.preserveFocusOnActivation({ detail: 1 }));
    unmountControl(result.current.actionRef);
    const cancel = mountControl(result.current.cancelRef);
    rerender({ status: 'connecting' });

    expect(document.activeElement).not.toBe(cancel);
  });

  it('does not steal focus after the user moves outside the dictation controls', () => {
    const { rerender, result } = renderHook(
      ({ status }: { status: RealtimeDictationStatus }) =>
        useDictationControlFocus({ retryable: false, status }),
      { initialProps: { status: 'idle' as RealtimeDictationStatus } },
    );
    const action = mountControl(result.current.actionRef);
    action.focus();

    act(() => result.current.preserveFocusOnActivation({ detail: 0 }));
    unmountControl(result.current.actionRef);
    mountControl(result.current.cancelRef);
    rerender({ status: 'connecting' });

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    unmountControl(result.current.cancelRef);
    const stop = mountControl(result.current.stopRef);
    mountControl(result.current.cancelRef);
    rerender({ status: 'listening' });

    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(stop);
  });
});
