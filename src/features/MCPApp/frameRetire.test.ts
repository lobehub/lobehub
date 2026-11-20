/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retireAppFrame } from './frameRetire';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// happy-dom has no `moveBefore`; this stand-in moves like it (browsers keep the
// iframe's document; here only where the node ends up matters)
const moveBefore = function (this: HTMLElement, node: Node, child: Node | null) {
  this.insertBefore(node, child);
};

const mountFrame = () => {
  const slot = document.createElement('div');
  const frame = document.createElement('iframe');
  slot.append(frame);
  document.body.append(slot);
  return { frame, slot };
};

describe('retireAppFrame', () => {
  beforeEach(() => {
    (HTMLElement.prototype as any).moveBefore = moveBefore;
  });

  afterEach(() => {
    delete (HTMLElement.prototype as any).moveBefore;
    document.body.innerHTML = '';
  });

  it('keeps an unmounted view running aside until it finished, then removes it', async () => {
    const { frame, slot } = mountFrame();
    let finish!: () => void;
    const teardown = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const keep = vi.fn();

    expect(retireAppFrame(frame, { keep, teardown })).toBe(true);
    // React then removes the view's slot
    slot.remove();
    await flush();

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(frame.isConnected).toBe(true);
    expect(frame.parentElement).not.toBe(slot);

    finish();
    await flush();
    expect(frame.isConnected).toBe(false);
    expect(keep).not.toHaveBeenCalled();
  });

  it('puts the frame back when its slot stays, as when StrictMode re-runs the effect', async () => {
    const { frame, slot } = mountFrame();
    const teardown = vi.fn(async () => {});
    const keep = vi.fn();

    retireAppFrame(frame, { keep, teardown });
    await flush();

    expect(frame.parentElement).toBe(slot);
    expect(keep).toHaveBeenCalledTimes(1);
    expect(teardown).not.toHaveBeenCalled();
  });

  it('leaves the frame alone where it cannot be moved without reloading', () => {
    delete (HTMLElement.prototype as any).moveBefore;
    const { frame, slot } = mountFrame();

    expect(retireAppFrame(frame, { keep: vi.fn(), teardown: vi.fn() })).toBe(false);
    expect(frame.parentElement).toBe(slot);
  });
});
