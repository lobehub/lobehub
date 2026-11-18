import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRepastePulse } from './useRepastePulse';

describe('useRepastePulse', () => {
  let element: HTMLDivElement;
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    element = document.createElement('div');
    animate = vi.fn(() => ({ cancel: vi.fn() }));
    element.animate = animate as any;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const render = (repastedAt?: number) =>
    renderHook(({ at }) => useRepastePulse({ current: element }, at), {
      initialProps: { at: repastedAt },
    });

  it('pulses the card each time the same image is pasted again', () => {
    const { rerender } = render();
    expect(animate).not.toHaveBeenCalled();

    rerender({ at: 1 });
    rerender({ at: 2 });

    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[0][0][1]).toMatchObject({ transform: 'scale(1.04)' });
  });

  it('stays still when a restored draft mounts with an earlier paste', () => {
    render(1);
    expect(animate).not.toHaveBeenCalled();
  });

  it('only lights the border under reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as any;
    const { rerender } = render();

    rerender({ at: 1 });

    expect(animate.mock.calls[0][0][1]).not.toHaveProperty('transform');
    expect(animate.mock.calls[0][0][1]).toHaveProperty('borderColor');
  });
});
