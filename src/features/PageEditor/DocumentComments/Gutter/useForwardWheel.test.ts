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
  // happy-dom's WheelEvent constructor doesn't forward ctrlKey from its init
  // dict (unlike plain MouseEvent), so set it directly when a test needs it.
  if (init.ctrlKey) Object.defineProperty(event, 'ctrlKey', { value: true });
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

  it('leaves a ctrl-modified wheel (browser zoom / trackpad pinch) to the browser', () => {
    const { host, pane } = setup();

    const event = wheel(host, { ctrlKey: true, deltaY: 40 });

    expect(pane.scrollTop).toBe(100);
    expect(event.defaultPrevented).toBe(false);
  });

  describe('touch', () => {
    const touch = (
      target: Element,
      type: 'touchend' | 'touchmove' | 'touchstart',
      clientY?: number,
    ) => {
      const event = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: clientY === undefined ? [] : ([{ clientY }] as unknown as Touch[]),
      });
      target.dispatchEvent(event);
      return event;
    };

    it('scrolls by the distance a one-finger drag crosses', () => {
      const { host, pane } = setup();

      touch(host, 'touchstart', 300);
      const event = touch(host, 'touchmove', 260);

      expect(pane.scrollTop).toBe(140);
      expect(event.defaultPrevented).toBe(true);
    });

    it('tracks a drag across several moves instead of only the first one', () => {
      const { host, pane } = setup();

      touch(host, 'touchstart', 300);
      touch(host, 'touchmove', 260);
      touch(host, 'touchmove', 240);

      expect(pane.scrollTop).toBe(160);
    });

    it('leaves a scrollable element inside the panel to scroll itself', () => {
      const { host, pane } = setup();
      const inner = document.createElement('div');
      inner.style.overflowY = 'auto';
      Object.defineProperty(inner, 'clientHeight', { configurable: true, value: 100 });
      Object.defineProperty(inner, 'scrollHeight', { configurable: true, value: 500 });
      host.append(inner);

      touch(inner, 'touchstart', 300);
      const event = touch(inner, 'touchmove', 260);

      expect(pane.scrollTop).toBe(100);
      expect(event.defaultPrevented).toBe(false);
    });

    it('starts a fresh drag after the finger lifts', () => {
      const { host, pane } = setup();

      touch(host, 'touchstart', 300);
      touch(host, 'touchend');
      touch(host, 'touchmove', 260);

      expect(pane.scrollTop).toBe(100);
    });
  });

  describe('keyboard', () => {
    const key = (target: Element, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };

    it('pages the document down on PageDown', () => {
      const { host, pane } = setup();

      const event = key(host, { key: 'PageDown' });

      expect(pane.scrollTop).toBe(700);
      expect(event.defaultPrevented).toBe(true);
    });

    it('pages the document up on PageUp', () => {
      const { host, pane } = setup();

      key(host, { key: 'PageUp' });

      expect(pane.scrollTop).toBe(-500);
    });

    it('pages down on Space and up on Shift+Space', () => {
      const { host, pane } = setup();

      key(host, { key: ' ' });
      expect(pane.scrollTop).toBe(700);

      key(host, { key: ' ', shiftKey: true });
      expect(pane.scrollTop).toBe(100);
    });

    it('leaves Space to a focused button instead of paging the document', () => {
      const { host, pane } = setup();
      const button = document.createElement('button');
      host.append(button);

      const event = key(button, { key: ' ' });

      expect(pane.scrollTop).toBe(100);
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves Space to a focused text field instead of paging the document', () => {
      const { host, pane } = setup();
      const input = document.createElement('input');
      host.append(input);

      const event = key(input, { key: ' ' });

      expect(pane.scrollTop).toBe(100);
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores unrelated keys', () => {
      const { host, pane } = setup();

      const event = key(host, { key: 'ArrowDown' });

      expect(pane.scrollTop).toBe(100);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
