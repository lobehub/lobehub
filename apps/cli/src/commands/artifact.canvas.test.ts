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
  runAgentTool: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    canvas: {
      getPublishContext: { query: mocks.getPublishContext },
      getVersion: { query: mocks.getVersion },
      publish: { mutate: mocks.publish },
      runAgentTool: { mutate: mocks.runAgentTool },
      save: { mutate: mocks.save },
    },
  }),
}));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://app.lobehub.com' }));

describe('artifact publish Canvas', () => {
  let root: string;
  let output: ReturnType<typeof vi.spyOn>;
  let exit: ReturnType<typeof vi.spyOn>;
  const manifest = () =>
    JSON.parse(fs.readFileSync(path.join(root, '.lobehub/artifacts.json'), 'utf8'));
  const binding = () => manifest().artifacts['report.html'];
  const payload = () => JSON.parse(output.mock.calls.flat().join('\n'));
  const run = async (...args: string[]) => {
    output.mockClear();
    const program = new Command().exitOverride();
    registerArtifactCommand(program);
    await program.parseAsync(['node', 'lh', 'artifact', ...args]);
  };
  const publish = (...args: string[]) =>
    run('publish', path.join(root, 'report.html'), '--root', root, '--json', ...args);

  beforeEach(() => {
    vi.resetAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-canvas-'));
    fs.writeFileSync(
      path.join(root, 'report.html'),
      '<title>Report</title><lobe-divider></lobe-divider>',
    );
    output = vi.spyOn(console, 'log').mockImplementation(() => {});
    exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    mocks.getPublishContext.mockResolvedValue({
      canPublish: true,
      userId: 'u1',
      workspaceId: null,
    });
    mocks.getVersion.mockResolvedValue({ canPublish: true, version: 1 });
    mocks.save.mockResolvedValue({ canvasId: 'cvs_1', workId: 'wk_1', version: 1 });
    mocks.publish.mockResolvedValue({
      deploymentId: 'dep_1',
      publishedVersion: 1,
      url: 'https://report.test',
    });
    mocks.runAgentTool.mockResolvedValue({
      output: { success: true, content: '# Canvas guide\nlobe-stat' },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('publishes Canvas and records its identity alongside the existing deployment binding', async () => {
    await publish('--type', 'canvas');
    expect(payload()).toMatchObject({
      canvasId: 'cvs_1',
      id: 'dep_1',
      publicUrl: 'https://report.test',
      version: 1,
    });
    expect(binding()).toMatchObject({
      type: 'canvas',
      canvasId: 'cvs_1',
      deploymentId: 'dep_1',
      version: 1,
    });
    expect(binding().pendingCreateKey).toBeUndefined();
    expect(mocks.save.mock.calls[0][0].html).toContain('lobe-divider');
  });

  it('inherits the bound type and updates the same Canvas on subsequent publishes', async () => {
    await publish('--type', 'canvas');
    mocks.save.mockResolvedValueOnce({ canvasId: 'cvs_1', workId: 'wk_1', version: 2 });
    mocks.publish.mockResolvedValueOnce({
      deploymentId: 'dep_1',
      publishedVersion: 2,
      url: 'https://report.test',
    });
    await publish();
    expect(payload()).toMatchObject({ canvasId: 'cvs_1', version: 2 });
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ canvasId: 'cvs_1', expectedVersion: 1 });
    expect(mocks.publish.mock.calls[1][0]).toMatchObject({ canvasId: 'cvs_1', version: 2 });
  });

  it('recovers a save whose response was lost using the persisted operation key', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Response lost'));
    await publish('--type', 'canvas');
    expect(exit).toHaveBeenCalledWith(1);
    expect(payload()).toMatchObject({ success: false });
    const key = binding().pendingCreateKey;
    expect(key).toEqual(expect.any(String));
    await publish();
    expect(mocks.save.mock.calls[1][0].requestId).toBe(key);
    expect(payload().canvasId).toBe('cvs_1');
  });

  it('retries a failed publication without creating another saved version', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('Publication result unknown'));
    await publish('--type', 'canvas');
    expect(payload()).toMatchObject({ success: false, canvasId: 'cvs_1', version: 1 });
    await publish();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(payload()).toMatchObject({ id: 'dep_1', version: 1 });
  });

  it('keeps --new pending across a failed publication and rebinds only after success', async () => {
    await publish('--type', 'canvas');
    mocks.save.mockResolvedValueOnce({ canvasId: 'cvs_new', workId: 'wk_new', version: 1 });
    mocks.publish.mockRejectedValueOnce(new Error('Lost'));
    await publish('--new');
    expect(binding().canvasId).toBe('cvs_1');
    expect(mocks.save.mock.calls[1][0].canvasId).toBeUndefined();
    await publish('--new');
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(binding().canvasId).toBe('cvs_new');
  });

  it('preserves the canonical binding when using a temporary deployment', async () => {
    await publish('--type', 'canvas');
    const original = binding();
    await publish('--deployment', 'dep_once');
    expect(mocks.publish.mock.calls.at(-1)?.[0].deploymentId).toBe('dep_once');
    expect(binding()).toEqual(original);
  });

  it('refuses changed content during recovery instead of using an old request key', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Lost'));
    await publish('--type', 'canvas');
    fs.writeFileSync(path.join(root, 'report.html'), '<h1>Changed</h1>');
    await publish();
    expect(payload()).toMatchObject({
      success: false,
      error: expect.stringMatching(/pending|changed/i),
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('allows fixing content after the server definitively rejects a save', async () => {
    mocks.save.mockRejectedValueOnce(
      Object.assign(new Error('Invalid Canvas'), { data: { code: 'BAD_REQUEST' } }),
    );
    await publish('--type', 'canvas');
    expect(payload().success).toBe(false);
    fs.writeFileSync(path.join(root, 'report.html'), '<h1>Fixed</h1>');
    await publish();
    expect(payload().canvasId).toBe('cvs_1');
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('reads a fresh expected version on an explicit retry after a save conflict', async () => {
    await publish('--type', 'canvas');
    mocks.save.mockRejectedValueOnce(
      Object.assign(new Error('Canvas version conflict'), { data: { code: 'CONFLICT' } }),
    );
    await publish();
    expect(payload().success).toBe(false);
    mocks.getVersion.mockResolvedValueOnce({ canPublish: true, version: 2 });
    await publish();
    expect(mocks.save.mock.calls.at(-1)?.[0].expectedVersion).toBe(2);
    expect(payload().canvasId).toBe('cvs_1');
  });

  it('restores an unbound one-off deployment after retrying a lost publish response', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('Response lost'));
    await publish('--type', 'canvas', '--deployment', 'dep_once');
    await publish('--type', 'canvas', '--deployment', 'dep_once');
    expect(binding()).toEqual({});
  });

  it('refuses a damaged saved version without publishing or overwriting recovery data', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('Response lost'));
    await publish('--type', 'canvas');
    const damaged = manifest();
    delete damaged.artifacts['report.html'].pendingCanvas.saved.version;
    const file = path.join(root, '.lobehub/artifacts.json');
    const content = JSON.stringify(damaged);
    fs.writeFileSync(file, content);
    await expect(publish()).rejects.toThrow();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
  });

  it('refuses a different account or workspace before touching a bound Canvas', async () => {
    await publish('--type', 'canvas');
    mocks.getPublishContext.mockResolvedValueOnce({
      canPublish: true,
      userId: 'u2',
      workspaceId: null,
    });
    await publish();
    expect(payload().success).toBe(false);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    mocks.getPublishContext.mockResolvedValueOnce({
      canPublish: true,
      userId: 'u1',
      workspaceId: 'ws_other',
    });
    await publish();
    expect(payload().success).toBe(false);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('rejects switching the bound type without --new', async () => {
    await publish('--type', 'canvas');
    await publish('--type', 'html');
    expect(exit).toHaveBeenCalledWith(1);
    expect(binding().canvasId).toBe('cvs_1');
  });

  it('prints the shared Canvas guide through the artifact command', async () => {
    await run('guide', 'canvas');
    expect(output.mock.calls.flat().join('\n')).toContain('# Canvas guide');
  });

  it('accepts a custom slug and returns both hosting and product share URLs', async () => {
    mocks.publish.mockResolvedValueOnce({
      deploymentId: 'dep_1',
      publishedVersion: 1,
      url: 'https://sales-report-1234abcd.lobe.page',
      subdomainLabel: 'sales-report-1234abcd',
    });
    await publish('--type', 'canvas', '--slug', 'sales-report');
    expect(payload()).toMatchObject({
      publicUrl: 'https://sales-report-1234abcd.lobe.page',
      shareUrl: 'https://app.lobehub.com/share/artifact/dep_1',
      subdomainLabel: 'sales-report-1234abcd',
    });
    expect(mocks.publish.mock.calls[0][0].requestedSlug).toBe('sales-report');
  });

  it.each([
    ['static', 'sales-report'],
    ['   ', 'sales-report'],
    ['a'.repeat(256), undefined],
  ])('allows correcting a rejected slug %s without saving another Canvas', async (slug, fixed) => {
    mocks.publish.mockRejectedValueOnce(
      Object.assign(new Error('Invalid slug'), { data: { code: 'BAD_REQUEST' } }),
    );
    await publish('--type', 'canvas', '--slug', slug);
    expect(payload().success).toBe(false);
    await publish(...(fixed ? ['--slug', fixed] : []));
    expect(payload()).toMatchObject({ id: 'dep_1', canvasId: 'cvs_1', version: 1 });
    expect(mocks.publish.mock.calls.at(-1)?.[0].requestedSlug).toBe(fixed);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('locks the corrected slug again when its publication result is unknown', async () => {
    mocks.publish
      .mockRejectedValueOnce(
        Object.assign(new Error('Invalid slug'), { data: { code: 'BAD_REQUEST' } }),
      )
      .mockRejectedValueOnce(new Error('Response lost'));
    await publish('--type', 'canvas', '--slug', 'static');
    await publish('--slug', 'fixed');
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    await publish('--slug', 'another');
    expect(payload().success).toBe(false);
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    await publish('--slug', 'fixed');
    expect(payload().id).toBe('dep_1');
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('still refuses changed content after a slug rejection', async () => {
    mocks.publish.mockRejectedValueOnce(
      Object.assign(new Error('Invalid slug'), { data: { code: 'BAD_REQUEST' } }),
    );
    await publish('--type', 'canvas', '--slug', 'static');
    fs.writeFileSync(path.join(root, 'report.html'), '<h1>Changed</h1>');
    await publish('--slug', 'fixed');
    expect(payload().success).toBe(false);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it.each(['new', 'deployment'])(
    'preserves the %s target while correcting a rejected slug',
    async (target) => {
      await publish('--type', 'canvas');
      const original = binding();
      const options = target === 'new' ? ['--new'] : ['--deployment', 'dep_once'];
      mocks.save.mockResolvedValueOnce({ canvasId: 'cvs_next', workId: 'wk_next', version: 1 });
      mocks.publish.mockRejectedValueOnce(
        Object.assign(new Error('Invalid slug'), { data: { code: 'BAD_REQUEST' } }),
      );
      await publish(...options, '--slug', 'static');
      await publish(...options, '--slug', 'fixed');
      expect(payload()).toMatchObject({ id: 'dep_1', canvasId: 'cvs_next', version: 1 });
      expect(mocks.save).toHaveBeenCalledTimes(2);
      expect(binding()).toMatchObject(target === 'new' ? { canvasId: 'cvs_next' } : original);
    },
  );
});
