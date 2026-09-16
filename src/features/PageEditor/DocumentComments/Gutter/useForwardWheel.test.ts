import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useForwardWheel } from './useForwardWheel';

const setup = () => {
  const host = document.createElement('div');
  const pane = document.createElement('div');
  document.body.append(host, pane);
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 600 });
  pane.scrollTop = 100;
  renderHook(() =>
    useForwardWheel({ current: host }, (delta) => {
      pane.scrollTop += delta;
    }),
  );
  return { host, pane };
};

const wheel = (target: Element, init: WheelEventInit) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('useForwardWheel', () => {
  it('hands the wheel delta to the sink and consumes the event', () => {
    const { host, pane } = setup();

    const event = wheel(host, { deltaY: 40 });

    expect(pane.scrollTop).toBe(140);
    expect(event.defaultPrevented).toBe(true);
  });

  it('scales line-based deltas into pixels', () => {
    const { host, pane } = setup();

    wheel(host, { deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: 3 });

    expect(pane.scrollTop).toBeGreaterThan(100 + 3);
  });

  it('leaves a scrollable element inside the panel to scroll itself', () => {
    const { host, pane } = setup();
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    Object.defineProperty(inner, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(inner, 'scrollHeight', { configurable: true, value: 500 });
    host.append(inner);

    const event = wheel(inner, { deltaY: 40 });

    expect(pane.scrollTop).toBe(100);
    expect(event.defaultPrevented).toBe(false);
  });

  it('forwards once an inner scroller has reached its end', () => {
    const { host, pane } = setup();
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    Object.defineProperty(inner, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(inner, 'scrollHeight', { configurable: true, value: 500 });
    inner.scrollTop = 400;
    host.append(inner);

    wheel(inner, { deltaY: 40 });

    expect(pane.scrollTop).toBe(140);
  });

  it('ignores purely horizontal gestures', () => {
    const { host, pane } = setup();

    const event = wheel(host, { deltaX: 40, deltaY: 0 });

    expect(pane.scrollTop).toBe(100);
    expect(event.defaultPrevented).toBe(false);
  });
});
