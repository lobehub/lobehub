import { beforeEach, describe, expect, it, vi } from 'vitest';

const callTool = vi.fn();

vi.mock('@lobechat/const', () => ({
  isDesktop: false,
}));

vi.mock('@/services/cloudSandbox', () => ({
  cloudSandboxService: {
    callTool,
  },
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    readLocalFileBytes: vi.fn(),
  },
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: {
    getLocalFilePreview: vi.fn(),
  },
}));

const { readWorkspaceAsset } = await import('./readWorkspaceAsset');

describe('readWorkspaceAsset', () => {
  beforeEach(() => {
    callTool.mockReset();
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
});
