import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { guestViewports } from '@/modules/browser/guestViewport';

import BrowserSidebarCtr from '../BrowserSidebarCtr';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn() },
  webContents: { fromId: vi.fn() },
}));

const capture = async (scale?: number) => {
  const capturePage = vi.fn().mockResolvedValue({
    getSize: () => ({ height: 10, width: 40 }),
    isEmpty: () => false,
    toJPEG: () => Buffer.from('jpeg'),
  });
  const guest = { capturePage } as unknown as WebContents;
  if (scale) {
    guestViewports.set(guest, {
      height: 900,
      panel: { height: 600, width: 400 },
      scale,
      width: 1600,
    });
  }

  vi.useFakeTimers();
  const controller = new BrowserSidebarCtr({} as App);
  const pending = (controller as any).captureElementThumbnail(guest, {
    rect: { height: 40, width: 160, x: 640, y: 400 },
    viewport: { height: 900, width: 1600 },
  });
  await vi.runAllTimersAsync();
  await pending;
  vi.useRealTimers();
  return capturePage;
};

describe('BrowserSidebarCtr element thumbnail', () => {
  it('crops in page pixels without a fixed viewport', async () => {
    expect(await capture()).toHaveBeenCalledWith({ height: 40, width: 160, x: 640, y: 400 });
  });

  // The picker measures in page (CSS) pixels, but a fitted agent viewport draws
  // the page shrunk: cropping at CSS x=640 captured blank or unrelated panel.
  it('scales the crop to the panel under a fitted viewport', async () => {
    expect(await capture(0.25)).toHaveBeenCalledWith({ height: 10, width: 40, x: 160, y: 100 });
  });
});
