import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArtifactCommand } from './artifact';

const mocks = vi.hoisted(() => ({
  getPublishContext: vi.fn(),
  getVersion: vi.fn(),
  publish: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    canvas: {
      getPublishContext: { query: mocks.getPublishContext },
      getVersion: { query: mocks.getVersion },
      publish: { mutate: mocks.publish },
      save: { mutate: mocks.save },
    },
  }),
}));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'http://localhost:3010' }));

describe('artifact save', () => {
  let root: string;
  let output: ReturnType<typeof vi.spyOn>;
  let exit: ReturnType<typeof vi.spyOn>;
  const binding = () =>
    JSON.parse(fs.readFileSync(path.join(root, '.lobehub/artifacts.json'), 'utf8')).artifacts[
      'screen.html'
    ];
  const payload = () => JSON.parse(output.mock.calls.flat().join('\n'));
  const save = async (...args: string[]) => {
    output.mockClear();
    const program = new Command().exitOverride();
    registerArtifactCommand(program);
    await program.parseAsync([
      'node',
      'lh',
      'artifact',
      'save',
      path.join(root, 'screen.html'),
      '--root',
      root,
      '--json',
      ...args,
    ]);
  };

  beforeEach(() => {
    vi.resetAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-canvas-save-'));
    fs.writeFileSync(path.join(root, 'screen.html'), '<title>Checkout</title><h1>Checkout</h1>');
    output = vi.spyOn(console, 'log').mockImplementation(() => {});
    exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    mocks.getPublishContext.mockResolvedValue({
      canPublish: false,
      userId: 'u1',
      workspaceId: null,
    });
    mocks.getVersion.mockResolvedValue({ canPublish: false, version: 1 });
    mocks.save.mockResolvedValue({ canvasId: 'cvs_1', version: 1, workId: 'wk_1' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { force: true, recursive: true });
  });

  it('saves a Canvas on a server that cannot publish, without publishing it', async () => {
    await save();
    expect(exit).not.toHaveBeenCalled();
    expect(payload()).toEqual({ canvasId: 'cvs_1', version: 1, workId: 'wk_1' });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      expectedVersion: 0,
      html: expect.stringContaining('<h1>Checkout</h1>'),
      title: 'Checkout',
    });
    expect(binding()).toMatchObject({ canvasId: 'cvs_1', type: 'canvas', version: 1 });
    expect(binding().pendingCreateKey).toBeUndefined();
  });

  it('saves the next version of the bound Canvas', async () => {
    await save();
    mocks.save.mockResolvedValueOnce({ canvasId: 'cvs_1', version: 2, workId: 'wk_1' });
    await save();
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ canvasId: 'cvs_1', expectedVersion: 1 });
    expect(payload()).toMatchObject({ canvasId: 'cvs_1', version: 2 });
  });

  it('starts a separate Canvas with --new', async () => {
    await save();
    mocks.save.mockResolvedValueOnce({ canvasId: 'cvs_2', version: 1, workId: 'wk_2' });
    await save('--new');
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ canvasId: undefined, expectedVersion: 0 });
    expect(binding()).toMatchObject({ canvasId: 'cvs_2', version: 1 });
  });

  it('retries a save whose response was lost with the same request id', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Response lost'));
    await save();
    expect(exit).toHaveBeenCalledWith(1);
    const { requestId } = mocks.save.mock.calls[0][0];
    await save();
    expect(mocks.save.mock.calls[1][0].requestId).toBe(requestId);
    expect(payload()).toMatchObject({ canvasId: 'cvs_1' });
  });

  it('does not replay a lost request once the content has changed', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Response lost'));
    await save();
    fs.writeFileSync(path.join(root, 'screen.html'), '<h1>Changed</h1>');
    await save();
    expect(mocks.save.mock.calls[1][0].requestId).not.toBe(mocks.save.mock.calls[0][0].requestId);
  });
});
