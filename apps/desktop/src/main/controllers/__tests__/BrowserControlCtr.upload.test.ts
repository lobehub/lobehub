import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import BrowserControlCtr from '../BrowserControlCtr';

vi.mock('electron', () => ({
  clipboard: { readText: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

/**
 * A guest page whose upload button creates its file input on click: the
 * debugger reports the chooser once real mouse input reaches the page.
 */
const createGuest = () => {
  const listeners = new Set<(event: unknown, method: string, params: unknown) => void>();
  let files: string[] = [];
  const dbg = {
    attach: vi.fn(),
    detach: vi.fn(),
    isAttached: vi.fn(() => dbg.attach.mock.calls.length > dbg.detach.mock.calls.length),
    on: vi.fn((_: string, listener: any) => listeners.add(listener)),
    removeListener: vi.fn((_: string, listener: any) => listeners.delete(listener)),
    sendCommand: vi.fn(async (method: string, params: any = {}) => {
      if (method === 'Runtime.evaluate') {
        return { result: { objectId: 'button', subtype: 'node', type: 'object' } };
      }
      if (method === 'Runtime.callFunctionOn') {
        const fn: string = params.functionDeclaration;
        if (fn.includes('isFileInput')) return { result: { subtype: 'null', type: 'object' } };
        if (fn.includes('getBoundingClientRect')) {
          return { result: { value: { height: 20, width: 80, x: 640, y: 400 } } };
        }
        return {
          result: {
            value: {
              disabled: false,
              files: files.map((file) => ({ name: path.basename(file), size: 3 })),
              multiple: false,
            },
          },
        };
      }
      if (method === 'DOM.setFileInputFiles') files = params.files;
      if (method === 'DOM.resolveNode') return { object: { objectId: 'input' } };
      return {};
    }),
  };
  const guest = {
    debugger: dbg,
    getTitle: () => 'Deploy',
    getURL: () => 'https://console.example/deploy',
    isDestroyed: () => false,
    mainFrame: { executeJavaScript: vi.fn().mockResolvedValue(undefined) },
    sendInputEvent: vi.fn((event: { type: string }) => {
      if (event.type !== 'mouseUp') return;
      for (const listener of listeners) {
        listener({}, 'Page.fileChooserOpened', { backendNodeId: 9, mode: 'selectSingle' });
      }
    }),
  };
  return guest;
};

describe('BrowserControlCtr uploadFile', () => {
  let dir: string;
  let zip: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lobe-upload-ctr-'));
    zip = path.join(dir, 'site.zip');
    await writeFile(zip, 'zip');
  });
  afterAll(() => rm(dir, { force: true, recursive: true }));

  const controllerFor = (guest: ReturnType<typeof createGuest> | undefined) =>
    new BrowserControlCtr({
      getController: () => ({
        getOverlayLabels: () => ({}),
        getSessionWebContents: () => guest,
      }),
    } as unknown as App);

  it('checks the paths before it touches the page', async () => {
    const guest = createGuest();

    await expect(
      controllerFor(guest).uploadFile({ paths: [path.join(dir, 'nope.zip')], sessionId: 's' }),
    ).resolves.toEqual({
      error: `Cannot upload: ${path.join(dir, 'nope.zip')}: no such file on this device`,
      success: false,
    });
    expect(guest.debugger.attach).not.toHaveBeenCalled();
  });

  it('asks for a page when the browser is not open', async () => {
    await expect(
      controllerFor(undefined).uploadFile({ paths: [zip], sessionId: 's' }),
    ).resolves.toMatchObject({ error: expect.stringContaining('navigate'), success: false });
  });

  it('clicks the upload button with real input and reports what the page received', async () => {
    const guest = createGuest();

    // Real timers: the path check does real file I/O before the cursor animation.
    const result = await controllerFor(guest).uploadFile({
      paths: [zip],
      ref: 'e4',
      sessionId: 's',
    });

    expect(result).toEqual({
      files: [{ name: 'site.zip', size: 3 }],
      success: true,
      title: 'Deploy',
      url: 'https://console.example/deploy',
      via: 'fileChooser',
    });
    expect(guest.sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseDown', x: 640, y: 400 }),
    );
    expect(guest.debugger.detach).toHaveBeenCalledOnce();
  });
});
