import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import BrowserControlCtr from '../BrowserControlCtr';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

const image = (empty = false) => ({
  getSize: () => ({ height: 800, width: 1200 }),
  isEmpty: () => empty,
  resize: vi.fn(),
  toJPEG: () => Buffer.from('jpeg'),
});

const createGuest = (capturePage: ReturnType<typeof vi.fn>) => ({
  capturePage,
  executeJavaScript: vi.fn().mockResolvedValue(undefined),
  isDestroyed: () => false,
  // Scripts run against the main frame, not the WebContents — the latter
  // defers until loading stops, which on a never-settling page is never.
  mainFrame: { executeJavaScript: vi.fn().mockResolvedValue(undefined) },
});

describe('BrowserControlCtr.screenshot', () => {
  let guest: ReturnType<typeof createGuest> | undefined;
  let controller: BrowserControlCtr;

  beforeEach(() => {
    vi.useRealTimers();
    guest = undefined;
    controller = new BrowserControlCtr({
      getController: () => ({ getSessionWebContents: () => guest }),
    } as unknown as App);
  });

  it('retries a guest whose compositor frame is not ready yet', async () => {
    // A guest that was just navigated or just shown rejects the first copy
    // with UnknownVizError until Chromium draws a frame for it.
    const capturePage = vi
      .fn()
      .mockRejectedValueOnce(new Error('UnknownVizError'))
      .mockResolvedValueOnce(image());
    guest = createGuest(capturePage);

    const result = await controller.screenshot({ sessionId: 'topic:a' });

    expect(result).toMatchObject({ height: 800, success: true, width: 1200 });
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(capturePage).toHaveBeenCalledTimes(2);
  });

  it('gives up with an actionable error instead of the bare viz error', async () => {
    const capturePage = vi.fn().mockRejectedValue(new Error('UnknownVizError'));
    guest = createGuest(capturePage);

    const result = await controller.screenshot({ sessionId: 'topic:a' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not be captured (UnknownVizError)');
    expect(result.error).toContain('snapshot/readPage still work');
    expect(capturePage).toHaveBeenCalledTimes(4);
  });

  it('times out a capture that never settles', async () => {
    vi.useFakeTimers();
    guest = createGuest(vi.fn(() => new Promise(() => {})));

    const pending = controller.screenshot({ sessionId: 'topic:a' });
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(pending).resolves.toMatchObject({
      error: expect.stringContaining('did not settle within 15000ms'),
      success: false,
    });
  });
});
