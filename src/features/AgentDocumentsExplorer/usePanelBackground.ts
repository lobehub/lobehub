import { type RefObject, useLayoutEffect, useState } from 'react';

const TRANSPARENT = new Set(['transparent', 'rgba(0, 0, 0, 0)']);

/**
 * Resolve the background actually painted behind a node.
 *
 * pierre's truncation marker paints the ellipsis over the characters it
 * replaces and masks them with `--truncate-marker-background-color`. The
 * document tree keeps its rows transparent so the surrounding panel shows
 * through, which leaves that mask with nothing to paint — the ellipsis lands on
 * top of the text. Feeding it the panel's own color fixes that, but the color is
 * not a constant: the documents page renders on `colorBgLayout` (#000) while the
 * conversation working sidebar renders on `colorBgContainer` (#0d0d0d), so a
 * single token leaves a visible patch on whichever surface it does not match.
 *
 * Walking up for the first non-transparent background reads whatever the current
 * host actually paints, so a third surface needs no change here. `fallback`
 * covers the case where every ancestor is transparent (nothing is painted, so
 * the mask has nothing to hide anyway).
 */
export const usePanelBackground = (
  ref: RefObject<HTMLElement | null>,
  fallback: string,
): string => {
  const [background, setBackground] = useState(fallback);

  useLayoutEffect(() => {
    let node: HTMLElement | null = ref.current;
    while (node) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && !TRANSPARENT.has(color)) {
        setBackground(color);
        return;
      }
      node = node.parentElement;
    }
    setBackground(fallback);
    // The theme swaps every token at once, so re-resolve whenever the fallback
    // (itself a themed token) changes.
  }, [fallback, ref]);

  return background;
};
