import { describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import BrowserControlCtr from '../BrowserControlCtr';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

/**
 * Electron's `WebContents.executeJavaScript` waits for the main frame to stop
 * loading. On a page with a request that never finishes it never runs, so the
 * fake mirrors that: it only settles via `mainFrame.executeJavaScript`.
 */
const createStillLoadingGuest = () => ({
  executeJavaScript: vi.fn(() => new Promise(() => {})),
  isDestroyed: () => false,
  mainFrame: {
    executeJavaScript: vi.fn(async (code: string) => {
      if (code.includes('__lobeBrowserRefs = refs'))
        return JSON.stringify({
          snapshot: '- heading "Hello" [ref=e1]',
          title: 'Slow',
          url: 'http://x/',
        });
      if (code.includes('innerText'))
        return JSON.stringify({
          content: 'Hello',
          selectedText: '',
          title: 'Slow',
          url: 'http://x/',
        });
      return undefined;
    }),
  },
});

describe('BrowserControlCtr on a page that is still loading', () => {
  const setup = () => {
    const guest = createStillLoadingGuest();
    const controller = new BrowserControlCtr({
      getController: () => ({ getSessionWebContents: () => guest }),
    } as unknown as App);
    return { controller, guest };
  };

  it('snapshots the current document instead of waiting for load to finish', async () => {
    const { controller, guest } = setup();

    await expect(controller.snapshot({ sessionId: 'topic:a' })).resolves.toMatchObject({
      snapshot: '- heading "Hello" [ref=e1]',
      success: true,
    });
    expect(guest.executeJavaScript).not.toHaveBeenCalled();
  });

  it('reads the page while it is still loading', async () => {
    const { controller } = setup();

    await expect(controller.readPage({ sessionId: 'topic:a' })).resolves.toMatchObject({
      content: 'Hello',
      success: true,
    });
  });
});
