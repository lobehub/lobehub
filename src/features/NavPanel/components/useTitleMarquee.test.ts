import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getTitleMarqueeTimeline,
  useTitleMarquee,
  useTitleMarqueeAvailable,
} from './useTitleMarquee';

const mocks = vi.hoisted(() => ({ reduceMotion: false }));

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useReducedMotion: () => mocks.reduceMotion,
}));

describe('getTitleMarqueeTimeline', () => {
  it.each([
    [3, 16],
    [32, 16],
    [400, 16],
    [10, 0],
  ])('keeps keyframe offsets non-decreasing for distance %i and fade %i', (distance, fade) => {
    const { duration, fadeIn, fadeOut, slideEnd, slideStart } = getTitleMarqueeTimeline(
      distance,
      fade,
    );

    expect(duration).toBeGreaterThan(0);
    const offsets = [0, slideStart, fadeIn, fadeOut, slideEnd, 1];
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  });

  it('slides at a constant speed, so a longer overflow takes longer', () => {
    expect(getTitleMarqueeTimeline(200, 16).duration).toBeGreaterThan(
      getTitleMarqueeTimeline(100, 16).duration,
    );
  });
});

const mountTitle = ({ textWidth, viewportWidth }: { textWidth: number; viewportWidth: number }) => {
  const viewport = document.createElement('span');
  const text = document.createElement('span');
  viewport.append(text);
  document.body.append(viewport);

  viewport.getBoundingClientRect = () => ({ left: 0, right: viewportWidth }) as DOMRect;
  Object.defineProperty(text, 'scrollWidth', { configurable: true, value: textWidth });

  const animations: { cancel: ReturnType<typeof vi.fn>; keyframes: Keyframe[] }[] = [];
  const animate = vi.fn((keyframes: Keyframe[]) => {
    const animation = { cancel: vi.fn(), keyframes };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  text.animate = animate;
  viewport.animate = animate;

  return { animate, animations, text, viewport };
};

const renderMarquee = (elements: ReturnType<typeof mountTitle>, enabled = true) => {
  const hook = renderHook(() => useTitleMarquee(enabled, 'title'));
  hook.result.current.viewportRef.current = elements.viewport;
  hook.result.current.textRef.current = elements.text;
  return hook;
};

describe('useTitleMarquee', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('slides an overflowing title by exactly its clipped width', () => {
    const elements = mountTitle({ textWidth: 300, viewportWidth: 200 });
    const { result } = renderMarquee(elements);

    act(() => result.current.start());

    const slide = elements.animations[0].keyframes;
    expect(slide.at(-1)?.transform).toBe('translateX(-100px)');
  });

  it('stops the tail where the hovered row starts fading under its actions', () => {
    const elements = mountTitle({ textWidth: 300, viewportWidth: 200 });
    const row = document.createElement('div');
    row.dataset.navItem = '';
    row.style.setProperty('--nav-item-actions-inset', '54px');
    const content = document.createElement('div');
    content.dataset.navItemContent = '';
    content.getBoundingClientRect = () => ({ right: 200 }) as DOMRect;
    content.append(elements.viewport);
    row.append(content);
    document.body.append(row);
    const { result } = renderMarquee(elements);

    act(() => result.current.start());

    // Readable up to 200 - 54 (actions) - 28 (content fade) = 118px.
    expect(elements.animations[0].keyframes.at(-1)?.transform).toBe('translateX(-182px)');
  });

  it('leaves a title that fits in place', () => {
    const elements = mountTitle({ textWidth: 150, viewportWidth: 200 });
    const { result } = renderMarquee(elements);

    act(() => result.current.start());

    expect(elements.animate).not.toHaveBeenCalled();
  });

  it('returns the title to its resting position when the pointer leaves', () => {
    const elements = mountTitle({ textWidth: 300, viewportWidth: 200 });
    const { result } = renderMarquee(elements);

    act(() => result.current.start());
    act(() => result.current.stop());

    for (const animation of elements.animations) expect(animation.cancel).toHaveBeenCalled();
  });

  it('does nothing for rows that did not opt in', () => {
    const elements = mountTitle({ textWidth: 300, viewportWidth: 200 });
    const { result } = renderMarquee(elements, false);

    act(() => result.current.start());

    expect(elements.animate).not.toHaveBeenCalled();
  });
});

describe('useTitleMarqueeAvailable', () => {
  beforeEach(() => {
    document.documentElement.dir = 'ltr';
    mocks.reduceMotion = false;
  });

  afterEach(() => {
    document.documentElement.dir = '';
  });

  it('replaces the tooltip in a left-to-right locale with motion allowed', () => {
    expect(renderHook(() => useTitleMarqueeAvailable()).result.current).toBe(true);
  });

  it('keeps the tooltip when the user prefers reduced motion', () => {
    mocks.reduceMotion = true;

    expect(renderHook(() => useTitleMarqueeAvailable()).result.current).toBe(false);
  });

  it('keeps the tooltip when the document is right-to-left', () => {
    document.documentElement.dir = 'rtl';

    expect(renderHook(() => useTitleMarqueeAvailable()).result.current).toBe(false);
  });
});
