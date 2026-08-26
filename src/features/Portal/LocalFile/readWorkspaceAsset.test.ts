import { beforeEach, describe, expect, it, vi } from 'vitest';

const callTool = vi.hoisted(() => vi.fn());
const getLocalFilePreview = vi.hoisted(() => vi.fn());
const readProjectFileBytes = vi.hoisted(() => vi.fn());

vi.mock('@/services/cloudSandbox', () => ({
  cloudSandboxService: {
    callTool,
  },
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: {
    getLocalFilePreview,
    readProjectFileBytes,
  },
}));

const { readWorkspaceAsset, resolveWorkspaceAssetContentType } =
  await import('./readWorkspaceAsset');

describe('resolveWorkspaceAssetContentType', () => {
  it('prefers the svg image type over a generic text/plain preview', () => {
    expect(resolveWorkspaceAssetContentType('/tmp/site/dot.svg', 'text/plain')).toBe(
      'image/svg+xml',
    );
    expect(resolveWorkspaceAssetContentType('/tmp/site/app.css', 'text/plain')).toBe('text/css');
    expect(resolveWorkspaceAssetContentType('/tmp/site/notes.bin', 'application/x-foo')).toBe(
      'application/x-foo',
    );
  });
});

describe('readWorkspaceAsset', () => {
  beforeEach(() => {
    callTool.mockReset();
    getLocalFilePreview.mockReset();
    readProjectFileBytes.mockReset();
  });

  it('reads sandbox text files through readLocalFile', async () => {
    callTool.mockResolvedValueOnce({
      result: { content: 'body { color: red; }', mimeType: 'text/css' },
      success: true,
    });

    await expect(
      readWorkspaceAsset({
        path: '/sandbox/app.css',
        sandboxTopicId: 'tpc_1',
        workingDirectory: '/sandbox',
      }),
    ).resolves.toEqual({
      bytes: new TextEncoder().encode('body { color: red; }'),
      contentType: 'text/css',
      ok: true,
      text: 'body { color: red; }',
    });

    expect(callTool).toHaveBeenCalledWith(
      'readLocalFile',
      { fullContent: true, path: '/sandbox/app.css' },
      { topicId: 'tpc_1' },
    );
  });

  it('reads sandbox binary files as bytes instead of text', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    callTool.mockResolvedValueOnce({
      result: { stdout: globalThis.btoa(String.fromCharCode(...png)) },
      success: true,
    });

    await expect(
      readWorkspaceAsset({
        path: '/sandbox/hero.png',
        sandboxTopicId: 'tpc_1',
        workingDirectory: '/sandbox',
      }),
    ).resolves.toEqual({
      bytes: png,
      contentType: 'image/png',
      ok: true,
    });

    expect(callTool).toHaveBeenCalledWith(
      'runCommand',
      expect.objectContaining({
        command: expect.stringContaining('python3'),
      }),
      { topicId: 'tpc_1' },
    );
    expect(callTool).not.toHaveBeenCalledWith(
      'readLocalFile',
      expect.anything(),
      expect.anything(),
    );
  });

  it('marks sandbox binary files unreadable when the byte export fails', async () => {
    callTool.mockResolvedValue({ result: { stdout: '' }, success: false });

    await expect(
      readWorkspaceAsset({
        path: '/sandbox/hero.png',
        sandboxTopicId: 'tpc_1',
        workingDirectory: '/sandbox',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unreadable' });
  });

  it('accepts a local asset larger than the former 8 MiB packaging cap', async () => {
    const bytes = new Uint8Array(9 * 1024 * 1024);
    getLocalFilePreview.mockResolvedValue({ type: 'unsupported' });
    readProjectFileBytes.mockResolvedValue({ bytes, contentType: 'application/javascript' });

    const result = await readWorkspaceAsset({
      path: '/tmp/runtime.js',
      workingDirectory: '/tmp',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes).toBe(bytes);
  });

  it('reports the measured size when a local asset exceeds the hosting hard limit', async () => {
    const bytes = new Uint8Array(50 * 1024 * 1024 + 1);
    getLocalFilePreview.mockResolvedValue({ type: 'unsupported' });
    readProjectFileBytes.mockResolvedValue({ bytes, contentType: 'application/javascript' });

    await expect(
      readWorkspaceAsset({ path: '/tmp/runtime.js', workingDirectory: '/tmp' }),
    ).resolves.toEqual({ ok: false, reason: 'oversized', sizeBytes: bytes.byteLength });
  });
});
