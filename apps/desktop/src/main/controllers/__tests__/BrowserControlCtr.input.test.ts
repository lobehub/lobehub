import { parseBrowserKey } from '@lobechat/device-control/browser-input';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import BrowserControlCtr, { keyInputEvents } from '../BrowserControlCtr';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

const createGuest = () => {
  const listeners: Record<string, () => void> = {};
  return {
    capturePage: vi.fn().mockResolvedValue({
      getSize: () => ({ height: 250, width: 400 }),
      isEmpty: () => false,
      toJPEG: () => Buffer.from('jpeg'),
    }),
    disableDeviceEmulation: vi.fn(),
    enableDeviceEmulation: vi.fn(),
    focus: vi.fn(),
    getTitle: () => 'T',
    getURL: () => 'https://u/',
    isDestroyed: () => false,
    listeners,
    mainFrame: {
      executeJavaScript: vi.fn(async (code: string) => {
        if (code.includes('innerHeight')) return JSON.stringify({ height: 600, width: 400 });
        if (code.includes('__lobeBrowserRefs')) return JSON.stringify({ x: 640, y: 400 });
        return undefined;
      }),
    },
    on: vi.fn((event: string, listener: () => void) => {
      listeners[event] = listener;
    }),
    selectAll: vi.fn(),
    sendInputEvent: vi.fn(),
  };
};

describe('keyInputEvents', () => {
  const events = (key: string) => keyInputEvents(parseBrowserKey(key, 'linux'));

  // Electron only knows `Down`/`Left`/…: `ArrowDown`, the manifest's own
  // example, reached the page as an empty key and moved nothing.
  it('spells arrow keys the way sendInputEvent understands', () => {
    expect(events('ArrowDown')).toEqual([
      { keyCode: 'Down', modifiers: [], type: 'keyDown' },
      { keyCode: 'Down', modifiers: [], type: 'keyUp' },
    ]);
  });

  // `Control+a` went out as one keyCode string, so the page got no Control
  // and the `char` event typed "Con" into the focused field.
  it('sends modifiers and types nothing for a chord', () => {
    expect(events('Control+a')).toEqual([
      { keyCode: 'a', modifiers: ['control'], type: 'keyDown' },
      { keyCode: 'a', modifiers: ['control'], type: 'keyUp' },
    ]);
  });

  it('types printable keys, shifted letters in upper case', () => {
    expect(events('Shift+a')[1]).toEqual({ keyCode: 'A', modifiers: ['shift'], type: 'char' });
    expect(events('Space')[1]).toEqual({ keyCode: ' ', modifiers: [], type: 'char' });
    expect(events('Enter')).toHaveLength(3);
    expect(events('Tab')).toHaveLength(2);
  });
});

describe('BrowserControlCtr input', () => {
  let guest: ReturnType<typeof createGuest>;
  let controller: BrowserControlCtr;

  beforeEach(() => {
    guest = createGuest();
    controller = new BrowserControlCtr({
      getController: () => ({
        getOverlayLabels: () => ({}),
        getSessionWebContents: () => guest,
      }),
    } as unknown as App);
  });

  it('fails an unknown key instead of reporting a press', async () => {
    await expect(controller.press({ key: 'Bogus', sessionId: 's' })).resolves.toMatchObject({
      error: expect.stringContaining('Unsupported key "Bogus"'),
      success: false,
    });
    expect(guest.sendInputEvent).not.toHaveBeenCalled();
  });

  it('runs the native editing command behind a macOS Meta shortcut', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    try {
      await expect(controller.press({ key: 'ControlOrMeta+a', sessionId: 's' })).resolves.toEqual({
        success: true,
      });
    } finally {
      platform.mockRestore();
    }
    expect(guest.sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ keyCode: 'a', modifiers: ['meta'], type: 'keyDown' }),
    );
    expect(guest.selectAll).toHaveBeenCalledOnce();
  });

  it('fits a fixed viewport into the panel and keeps it across navigations', async () => {
    await expect(
      controller.setViewport({ height: 900, sessionId: 's', width: 1600 }),
    ).resolves.toEqual({ scale: 0.25, success: true });

    const emulation = {
      deviceScaleFactor: 0,
      scale: 0.25,
      screenPosition: 'desktop',
      screenSize: { height: 900, width: 1600 },
      viewPosition: { x: 0, y: 0 },
      viewSize: { height: 900, width: 1600 },
    };
    expect(guest.enableDeviceEmulation).toHaveBeenLastCalledWith(emulation);

    guest.enableDeviceEmulation.mockClear();
    guest.listeners['did-navigate']();
    expect(guest.enableDeviceEmulation).toHaveBeenCalledWith(emulation);
  });

  it('clicks at panel coordinates and captures only the page under a fitted viewport', async () => {
    await controller.setViewport({ height: 900, sessionId: 's', width: 1600 });

    vi.useFakeTimers();
    const click = controller.click({ ref: 'e1', sessionId: 's' });
    await vi.runAllTimersAsync();
    await click;
    vi.useRealTimers();

    // The ref sits at CSS (640, 400); the panel draws the page at 25%.
    expect(guest.sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseDown', x: 160, y: 100 }),
    );

    await controller.screenshot({ sessionId: 's' });
    expect(guest.capturePage).toHaveBeenCalledWith({ height: 225, width: 400, x: 0, y: 0 });
  });

  it('resets to the panel size without a size', async () => {
    await controller.setViewport({ height: 900, sessionId: 's', width: 1600 });

    await expect(controller.setViewport({ sessionId: 's' })).resolves.toEqual({
      scale: 1,
      success: true,
    });
    expect(guest.disableDeviceEmulation).toHaveBeenCalledOnce();

    guest.enableDeviceEmulation.mockClear();
    guest.listeners['did-navigate']();
    expect(guest.enableDeviceEmulation).not.toHaveBeenCalled();
  });

  it('rejects a half-specified viewport', async () => {
    await expect(controller.setViewport({ sessionId: 's', width: 1600 })).resolves.toMatchObject({
      error: expect.stringContaining('height must be'),
      success: false,
    });
  });
});
