'use client';

import type { KeyboardEvent, MouseEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type { RealtimeDictationStatus } from './contract';

interface DictationControlFocusOptions {
  active: boolean;
  retryable: boolean;
  status: RealtimeDictationStatus;
}

interface DictationControlRefs {
  actionRef: RefObject<HTMLButtonElement | null>;
  cancelRef: RefObject<HTMLButtonElement | null>;
  retryRef: RefObject<HTMLButtonElement | null>;
  stopRef: RefObject<HTMLButtonElement | null>;
}

const getFocusTarget = (
  refs: DictationControlRefs,
  status: RealtimeDictationStatus,
  retryable: boolean,
  active: boolean,
) => {
  if (!active) return refs.actionRef.current;
  if (status === 'listening') return refs.stopRef.current;
  if (status === 'error' && retryable) return refs.retryRef.current;

  return refs.cancelRef.current;
};

export const useDictationControlFocus = ({
  active,
  retryable,
  status,
}: DictationControlFocusOptions) => {
  const actionRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const awaitingSessionRef = useRef(false);
  const manageFocusRef = useRef(false);

  const preserveFocusOnActivation = useCallback(
    (event: Pick<MouseEvent, 'detail'>) => {
      manageFocusRef.current = event.detail === 0;
      awaitingSessionRef.current = event.detail === 0 && !active;
    },
    [active],
  );

  const handleKeyboardActivation = useCallback(
    (
      event: Pick<KeyboardEvent<HTMLButtonElement>, 'key' | 'preventDefault' | 'repeat'>,
      activate: () => void,
    ) => {
      if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;

      event.preventDefault();
      manageFocusRef.current = true;
      awaitingSessionRef.current = !active;
      activate();
    },
    [active],
  );

  useEffect(() => {
    if (!manageFocusRef.current) return;

    if (status !== 'idle') awaitingSessionRef.current = false;

    const refs = { actionRef, cancelRef, retryRef, stopRef };
    const controls = Object.values(refs)
      .map((ref) => ref.current)
      .filter((control): control is HTMLButtonElement => Boolean(control));
    const activeElement = document.activeElement;

    if (
      activeElement &&
      activeElement !== document.body &&
      !controls.includes(activeElement as HTMLButtonElement)
    ) {
      manageFocusRef.current = false;
      return;
    }

    getFocusTarget(refs, status, retryable, active)?.focus({ preventScroll: true });

    if (!active && !awaitingSessionRef.current) manageFocusRef.current = false;
  }, [active, retryable, status]);

  return {
    actionRef,
    cancelRef,
    handleKeyboardActivation,
    preserveFocusOnActivation,
    retryRef,
    stopRef,
  };
};
