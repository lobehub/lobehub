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
  actionRef: RefObject<HTMLDivElement | null>;
  cancelRef: RefObject<HTMLDivElement | null>;
  retryRef: RefObject<HTMLDivElement | null>;
  stopRef: RefObject<HTMLDivElement | null>;
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
  const actionRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<HTMLDivElement>(null);
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
      event: Pick<KeyboardEvent<HTMLDivElement>, 'key' | 'preventDefault' | 'repeat'>,
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
      .filter((control): control is HTMLDivElement => Boolean(control));
    const activeElement = document.activeElement;

    if (
      activeElement &&
      activeElement !== document.body &&
      !controls.includes(activeElement as HTMLDivElement)
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
