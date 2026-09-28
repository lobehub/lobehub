import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_WIDTH, MIN_WIDTH } from '../const';

export const usePanelWidthConstraints = (panelWidth: number) => {
  const [availableWidth, setAvailableWidth] = useState(MAX_WIDTH);
  const observerRef = useRef<ResizeObserver | null>(null);

  const probeRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node) return;

    const measure = () => {
      if (node.clientWidth > 0) setAvailableWidth(node.clientWidth);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;

    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(node);
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    [],
  );

  return {
    constrainedWidth: Math.min(panelWidth, availableWidth),
    maxWidth: Math.min(MAX_WIDTH, availableWidth),
    minWidth: Math.min(MIN_WIDTH, availableWidth),
    probeRef,
  };
};
