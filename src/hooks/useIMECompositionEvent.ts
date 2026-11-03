import type { CompositionEvent } from 'react';
import { useCallback, useRef } from 'react';

interface IMECompositionEventOptions {
  onCompositionEnd?: (e: CompositionEvent) => void;
  onCompositionStart?: (e: CompositionEvent) => void;
}

/**
 * Hook to track IME composition state (e.g. Chinese input).
 * Use this to avoid triggering Enter key handlers during composition.
 */
export const useIMECompositionEvent = (mergeProps?: IMECompositionEventOptions) => {
  const isComposingRef = useRef(false);
  const mergePropsRef = useRef(mergeProps);
  mergePropsRef.current = mergeProps;

  const onCompositionEnd = useCallback((e: CompositionEvent) => {
    isComposingRef.current = false;
    mergePropsRef.current?.onCompositionEnd?.(e);
  }, []);

  const onCompositionStart = useCallback((e: CompositionEvent) => {
    isComposingRef.current = true;
    mergePropsRef.current?.onCompositionStart?.(e);
  }, []);

  return {
    compositionProps: {
      onCompositionEnd,
      onCompositionStart,
    },
    isComposingRef,
  };
};
