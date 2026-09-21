import { useLayoutEffect, useState } from 'react';

/**
 * Track an element's content width across node swaps.
 *
 * A `useRef` + one-shot `ResizeObserver` keeps observing the node it first saw.
 * The reject modal replaces that node whenever the layout flips between the
 * desktop and phone branch — after which the observer is watching a detached
 * element and the width freezes at whatever the previous layout measured
 * (often 0, while the modal was still animating open). A zoom factor
 * multiplied into a frozen or zero width is why the phone viewer showed 200%
 * and rendered the image at fit-width.
 *
 * Keying the observer to the node itself re-measures on every swap. A zero
 * width means "not laid out yet", never a real measurement, so callers fall
 * back to intrinsic sizing until a real number arrives.
 */
export const useMeasuredWidth = <T extends HTMLElement = HTMLDivElement>() => {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setWidth(node.clientWidth || undefined);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { node, ref: setNode, width };
};
