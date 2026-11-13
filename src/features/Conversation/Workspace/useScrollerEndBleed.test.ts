import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONVERSATION_SCROLLER_END_BLEED_VAR } from '@/features/Conversation/ChatList/constants';

import { useScrollerEndBleed } from './useScrollerEndBleed';

interface Observation {
  callback: ResizeObserverCallback;
  disconnected: boolean;
  targets: Element[];
}

let observations: Observation[] = [];

const resize = (target: Element, inlineSize: number) => {
  for (const observation of observations) {
    if (observation.disconnected || !observation.targets.includes(target)) continue;
    const entry = { borderBoxSize: [{ blockSize: 0, inlineSize }], target };
    observation.callback([entry as unknown as ResizeObserverEntry], {} as ResizeObserver);
  }
};

const setup = () => {
  const { result } = renderHook(() => useScrollerEndBleed());
  const host = document.createElement('div');
  const panel = document.createElement('div');
  (result.current.hostRef as RefObject<HTMLDivElement>).current = host;
  const cleanup = result.current.panelRef(panel);
  const bleed = () => host.style.getPropertyValue(CONVERSATION_SCROLLER_END_BLEED_VAR);

  return { bleed, cleanup, panel };
};

describe('useScrollerEndBleed', () => {
  beforeEach(() => {
    observations = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private observation: Observation;

        constructor(callback: ResizeObserverCallback) {
          this.observation = { callback, disconnected: false, targets: [] };
          observations.push(this.observation);
        }

        disconnect() {
          this.observation.disconnected = true;
        }

        observe(target: Element) {
          this.observation.targets.push(target);
        }

        unobserve() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extends the scroller on the host by the floating panel slot width', () => {
    const { bleed, panel } = setup();

    resize(panel, 384);

    expect(bleed()).toBe('384px');
  });

  it('follows the slot through its open/close animation', () => {
    const { bleed, panel } = setup();

    resize(panel, 384);
    resize(panel, 120);
    expect(bleed()).toBe('120px');

    resize(panel, 0);
    expect(bleed()).toBe('0px');
  });

  it('stops observing and drops the extension when the slot detaches', () => {
    const { bleed, cleanup, panel } = setup();
    resize(panel, 384);

    cleanup?.();

    expect(observations.every(({ disconnected }) => disconnected)).toBe(true);
    expect(bleed()).toBe('');
  });
});
