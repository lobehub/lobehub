import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { WebContents } from 'electron';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  checkUploadPaths,
  FILE_INPUT_OF,
  MAX_UPLOAD_FILES,
  uploadFilesToGuest,
  uploadTargetExpression,
} from './fileUpload';

type Listener = (event: unknown, method: string, params: any) => void;

interface FakePage {
  /** What `FILE_INPUT_OF` finds for the target: an input, or nothing. */
  input?: { accept?: string; disabled?: boolean; multiple?: boolean };
  /** What a click on the target opens. */
  onClick?: 'nothing' | { backendNodeId?: number; mode: 'selectMultiple' | 'selectSingle' };
  /** What the target expression evaluates to. */
  target?: 'element' | string;
}

/**
 * A guest whose debugger answers the CDP calls the upload makes, keeping the
 * files set through `DOM.setFileInputFiles` so read-backs report them.
 */
const createGuest = (page: FakePage, { attachThrows = false, attached = false } = {}) => {
  const listeners = new Set<Listener>();
  let isAttached = attached;
  let files: string[] = [];
  const dbg = {
    attach: vi.fn(() => {
      if (attachThrows) throw new Error('No target available');
      isAttached = true;
    }),
    detach: vi.fn(() => {
      isAttached = false;
    }),
    isAttached: () => isAttached,
    on: vi.fn((_: string, listener: Listener) => listeners.add(listener)),
    removeListener: vi.fn((_: string, listener: Listener) => listeners.delete(listener)),
    sendCommand: vi.fn(async (method: string, params: any = {}) => {
      switch (method) {
        case 'Runtime.evaluate': {
          const target = page.target ?? 'element';
          return {
            result:
              target === 'element'
                ? { objectId: 'target', subtype: 'node', type: 'object' }
                : { type: 'string', value: target },
          };
        }
        case 'Runtime.callFunctionOn': {
          const fn: string = params.functionDeclaration;
          if (fn === FILE_INPUT_OF) {
            return {
              result: page.input
                ? { objectId: 'input', subtype: 'node', type: 'object' }
                : { subtype: 'null', type: 'object' },
            };
          }
          if (fn.includes('getBoundingClientRect')) {
            return { result: { type: 'object', value: { height: 30, width: 100, x: 50, y: 60 } } };
          }
          // Read the input back.
          return {
            result: {
              type: 'object',
              value: {
                accept: page.input?.accept,
                disabled: !!page.input?.disabled,
                files: files.map((file) => ({ name: path.basename(file), size: 3 })),
                multiple: !!page.input?.multiple,
              },
            },
          };
        }
        case 'DOM.setFileInputFiles': {
          files = params.files;
          return {};
        }
        case 'DOM.resolveNode': {
          return { object: { objectId: 'chooser-input', type: 'object' } };
        }
        default: {
          return {};
        }
      }
    }),
  };

  const clickAt = vi.fn(async () => {
    const opened = page.onClick;
    if (!opened || opened === 'nothing') return;
    for (const listener of listeners) listener({}, 'Page.fileChooserOpened', opened);
  });

  return { clickAt, dbg, guest: { debugger: dbg } as unknown as WebContents, listeners };
};

const commands = (dbg: ReturnType<typeof createGuest>['dbg']) =>
  dbg.sendCommand.mock.calls.map(([method]) => method);

describe('checkUploadPaths', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lobe-upload-'));
    await writeFile(path.join(dir, 'site.zip'), 'zip');
    await mkdir(path.join(dir, 'folder'));
  });
  afterAll(() => rm(dir, { force: true, recursive: true }));

  it('accepts existing files', async () => {
    await expect(checkUploadPaths([path.join(dir, 'site.zip')])).resolves.toEqual({
      paths: [path.join(dir, 'site.zip')],
    });
  });

  it('expands a leading ~ to the home folder', async () => {
    const home = vi.spyOn(os, 'homedir').mockReturnValue(dir);
    await expect(checkUploadPaths(['~/site.zip'])).resolves.toEqual({
      paths: [path.join(dir, 'site.zip')],
    });
    home.mockRestore();
  });

  // Chromium attaches a missing path as an empty file without complaint, so
  // the page would "upload" nothing while the agent reported success.
  it('names every path it refuses', async () => {
    const result = await checkUploadPaths([
      'relative/site.zip',
      path.join(dir, 'missing.zip'),
      path.join(dir, 'folder'),
      42,
    ]);
    expect('error' in result && result.error).toBe(
      `Cannot upload: relative/site.zip is not an absolute path; ${path.join(dir, 'missing.zip')}: no such file on this device; ${path.join(dir, 'folder')} is not a file; 42 is not a path`,
    );
  });

  it('needs at least one path and caps the count', async () => {
    await expect(checkUploadPaths([])).resolves.toHaveProperty('error');
    await expect(checkUploadPaths('site.zip')).resolves.toHaveProperty('error');
    await expect(
      checkUploadPaths(Array.from({ length: MAX_UPLOAD_FILES + 1 }, () => '/x')),
    ).resolves.toEqual({ error: `At most ${MAX_UPLOAD_FILES} files can be uploaded at once` });
  });
});

describe('uploadFilesToGuest', () => {
  it('sets the files on the targeted input and reads them back', async () => {
    const { clickAt, dbg, guest } = createGuest({ input: { accept: '.zip' } });

    await expect(
      uploadFilesToGuest(guest, { paths: ['/u/site.zip'], ref: 'e3' }, { clickAt }),
    ).resolves.toEqual({
      accept: '.zip',
      files: [{ name: 'site.zip', size: 3 }],
      success: true,
      via: 'input',
    });

    expect(dbg.sendCommand).toHaveBeenCalledWith('DOM.setFileInputFiles', {
      files: ['/u/site.zip'],
      objectId: 'input',
    });
    expect(clickAt).not.toHaveBeenCalled();
    expect(dbg.attach).toHaveBeenCalledWith('1.3');
    expect(dbg.detach).toHaveBeenCalledOnce();
  });

  it('refuses several files for a single-file input before touching it', async () => {
    const { dbg, guest } = createGuest({ input: {} });

    await expect(
      uploadFilesToGuest(guest, { paths: ['/a', '/b'], ref: 'e3' }, { clickAt: vi.fn() }),
    ).resolves.toMatchObject({ error: expect.stringContaining('single file'), success: false });
    expect(commands(dbg)).not.toContain('DOM.setFileInputFiles');
  });

  it('refuses a disabled input', async () => {
    const { guest } = createGuest({ input: { disabled: true } });

    await expect(
      uploadFilesToGuest(guest, { paths: ['/a'], ref: 'e3' }, { clickAt: vi.fn() }),
    ).resolves.toEqual({ error: 'The file input is disabled', success: false });
  });

  it('passes on why the target could not be found', async () => {
    const { dbg, guest } = createGuest({ target: 'ref not found — take a new snapshot first' });

    await expect(
      uploadFilesToGuest(guest, { paths: ['/a'], ref: 'e9' }, { clickAt: vi.fn() }),
    ).resolves.toEqual({ error: 'ref not found — take a new snapshot first', success: false });
    expect(dbg.detach).toHaveBeenCalledOnce();
  });

  // The input only exists once the page's upload button runs its handler.
  it('catches the file chooser a click opens and fills its input', async () => {
    const { clickAt, dbg, guest, listeners } = createGuest({
      onClick: { backendNodeId: 7, mode: 'selectSingle' },
    });

    await expect(
      uploadFilesToGuest(guest, { paths: ['/u/config.json'], ref: 'e7' }, { clickAt }),
    ).resolves.toEqual({
      files: [{ name: 'config.json', size: 3 }],
      success: true,
      via: 'fileChooser',
    });

    expect(clickAt).toHaveBeenCalledWith(50, 60);
    expect(dbg.sendCommand).toHaveBeenCalledWith('Page.setInterceptFileChooserDialog', {
      enabled: true,
    });
    expect(dbg.sendCommand).toHaveBeenCalledWith('DOM.setFileInputFiles', {
      backendNodeId: 7,
      files: ['/u/config.json'],
    });
    expect(dbg.sendCommand).toHaveBeenLastCalledWith('Page.setInterceptFileChooserDialog', {
      enabled: false,
    });
    expect(listeners.size).toBe(0);
  });

  it('answers manual selection when the click opens no chooser', async () => {
    const { clickAt, dbg, guest } = createGuest({ onClick: 'nothing' });

    await expect(
      uploadFilesToGuest(
        guest,
        { paths: ['/u/site.zip'], ref: 'e8' },
        { chooserTimeoutMs: 10, clickAt },
      ),
    ).resolves.toMatchObject({ manualSelectionRequired: true, success: false });
    expect(dbg.sendCommand).toHaveBeenLastCalledWith('Page.setInterceptFileChooserDialog', {
      enabled: false,
    });
    expect(dbg.detach).toHaveBeenCalledOnce();
  });

  it('answers manual selection for a picker that has no input behind it', async () => {
    const { clickAt, guest } = createGuest({ onClick: { mode: 'selectSingle' } });

    await expect(
      uploadFilesToGuest(guest, { paths: ['/u/site.zip'], ref: 'e8' }, { clickAt }),
    ).resolves.toMatchObject({ manualSelectionRequired: true, success: false });
  });

  it('answers manual selection when the page cannot be inspected', async () => {
    const { guest } = createGuest({ input: {} }, { attachThrows: true });

    await expect(
      uploadFilesToGuest(guest, { paths: ['/a'], ref: 'e3' }, { clickAt: vi.fn() }),
    ).resolves.toMatchObject({
      error: expect.stringContaining('No target available'),
      manualSelectionRequired: true,
      success: false,
    });
  });

  it('leaves a debugger session it did not open attached', async () => {
    const { dbg, guest } = createGuest({ input: {} }, { attached: true });

    await uploadFilesToGuest(guest, { paths: ['/a'], ref: 'e3' }, { clickAt: vi.fn() });

    expect(dbg.attach).not.toHaveBeenCalled();
    expect(dbg.detach).not.toHaveBeenCalled();
  });
});

describe('uploadTargetExpression', () => {
  it('embeds the ref and selector as literals', () => {
    expect(uploadTargetExpression('e1', `a"]');alert(1)//`)).toContain(
      JSON.stringify(`a"]');alert(1)//`),
    );
  });
});
