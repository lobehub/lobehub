import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useResultAnchorRail } from './useResultAnchorRail';

const scrollTo = vi.fn();

const setReducedMotion = (reduce: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    addEventListener: vi.fn(),
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
  }));
};

/** A scrolling page with one section per label, plus the root the rail scans. */
const buildPage = (labels: string[]) => {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  const root = document.createElement('div');
  scroller.append(root);
  document.body.append(scroller);
  for (const label of labels) {
    const section = document.createElement('div');
    section.setAttribute('data-result-anchor', `section-${label}`);
    section.setAttribute('data-result-anchor-label', label);
    section.setAttribute('data-result-anchor-level', '0');
    root.append(section);
  }
  return { root, scroller };
};

beforeEach(() => {
  // The rail marks sections that render something, and jsdom has no layout.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 40,
  });
  Element.prototype.scrollTo = scrollTo as never;
  setReducedMotion(false);
});

afterEach(() => {
  scrollTo.mockClear();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('useResultAnchorRail', () => {
  it('keeps up with a label rewritten in place, with no child added or removed', async () => {
    const { root } = buildPage(['Alpha', 'Bravo', 'Charlie']);
    const { result } = renderHook(() => useResultAnchorRail({ rootRef: { current: root } }));
    await waitFor(() => expect(result.current.anchors).toHaveLength(3));
    expect(result.current.anchors[1].label).toBe('Bravo');

    // What a language switch does: the attribute on the section that is already
    // there gets rewritten. The child list never changes, so a rail that only
    // watched childList would keep the previous language on every tick.
    root
      .querySelector('[data-result-anchor="section-Bravo"]')!
      .setAttribute('data-result-anchor-label', '布拉沃');

    await waitFor(() => expect(result.current.anchors[1].label).toBe('布拉沃'));
  });

  it('jumps without animation when the reader asked for reduced motion', async () => {
    setReducedMotion(true);
    const { root } = buildPage(['Alpha', 'Bravo', 'Charlie']);
    const { result } = renderHook(() => useResultAnchorRail({ rootRef: { current: root } }));
    await waitFor(() => expect(result.current.anchors).toHaveLength(3));

    result.current.jumpTo('section-Charlie');

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('keeps the animated jump when motion is welcome', async () => {
    const { root } = buildPage(['Alpha', 'Bravo', 'Charlie']);
    const { result } = renderHook(() => useResultAnchorRail({ rootRef: { current: root } }));
    await waitFor(() => expect(result.current.anchors).toHaveLength(3));

    result.current.jumpTo('section-Charlie');

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });
});
