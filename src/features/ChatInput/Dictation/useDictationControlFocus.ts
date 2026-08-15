'use client';

import type { MouseEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type { RealtimeDictationStatus } from './contract';

interface DictationControlFocusOptions {
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
) => {
  if (status === 'idle') return refs.actionRef.current;
  if (status === 'listening') return refs.stopRef.current;
  if (status === 'error' && retryable) return refs.retryRef.current;

  return refs.cancelRef.current;
};

export const useDictationControlFocus = ({ retryable, status }: DictationControlFocusOptions) => {
  const actionRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<HTMLDivElement>(null);
  const manageFocusRef = useRef(false);

  const preserveFocusOnActivation = useCallback((event: Pick<MouseEvent, 'detail'>) => {
    manageFocusRef.current = event.detail === 0;
  }, []);

  useEffect(() => {
    if (!manageFocusRef.current) return;

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

    getFocusTarget(refs, status, retryable)?.focus({ preventScroll: true });

    if (status === 'idle') manageFocusRef.current = false;
  }, [retryable, status]);

  return {
    actionRef,
    cancelRef,
    preserveFocusOnActivation,
    retryRef,
    stopRef,
  };
};
