'use client';

import {
  createContext,
  type CSSProperties,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
} from 'react';

type ScrollSubscriber = () => void;
type Subscribe = (cb: ScrollSubscriber) => () => void;

const ScrollSignalContext = createContext<Subscribe | null>(null);

interface ScrollSignalProviderProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Wraps a scrollable container and broadcasts a signal to descendants whenever
 * the user scrolls. Mirrors the pattern used by the model selector list so that
 * any hover popover anchored to a row inside the scroller can close itself when
 * its trigger has presumably moved out from under the cursor.
 */
export const ScrollSignalProvider = ({
  ref,
  children,
  className,
  style,
}: ScrollSignalProviderProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const listenersRef = useRef<Set<ScrollSubscriber>>(new Set());

  const subscribe = useCallback<Subscribe>((cb) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const handleScroll = useCallback(() => {
    listenersRef.current.forEach((cb) => cb());
  }, []);

  return (
    <ScrollSignalContext value={subscribe}>
      <div className={className} ref={ref} style={style} onScroll={handleScroll}>
        {children}
      </div>
    </ScrollSignalContext>
  );
};

ScrollSignalProvider.displayName = 'ScrollSignalProvider';

/**
 * Subscribe to scroll events of the nearest ScrollSignalProvider ancestor.
 * If no provider is present this is a no-op.
 */
export const useScrollSignal = (cb: ScrollSubscriber) => {
  const subscribe = use(ScrollSignalContext);
  // Re-attach when the callback identity changes.
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  }, [cb]);

  useEffect(() => {
    if (!subscribe) return;
    return subscribe(() => cbRef.current());
  }, [subscribe]);
};

export type { Subscribe as ScrollSignalSubscribe };
