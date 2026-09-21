import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cloudSandboxService } from '@/services/cloudSandbox';
import { projectFileService } from '@/services/projectFile';

import { createWorkspaceHtmlPublishFileOps } from './workspaceHtmlPublishFileOps';

vi.mock('@/services/cloudSandbox', () => ({
  cloudSandboxService: { callTool: vi.fn() },
}));
vi.mock('@/services/projectFile', () => ({
  projectFileService: { copyAssetForPublish: vi.fn(), writeProjectFile: vi.fn() },
}));

describe('createWorkspaceHtmlPublishFileOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes local and device files through projectFileService', async () => {
    vi.mocked(projectFileService.copyAssetForPublish).mockResolvedValue({ success: true });
    vi.mocked(projectFileService.writeProjectFile).mockResolvedValue({ success: true });
    const ops = createWorkspaceHtmlPublishFileOps({ deviceId: 'dev-1', workingDirectory: '/ws' });

    await ops.copyFile('/outside/logo.png', '/ws/.lobe-artifacts/site/logo.png');
    await ops.writeFile('/ws/.lobe-artifacts/site/index.html', '<html/>');

    expect(projectFileService.copyAssetForPublish).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      from: '/outside/logo.png',
      to: '/ws/.lobe-artifacts/site/logo.png',
      workingDirectory: '/ws',
    });
    expect(projectFileService.writeProjectFile).toHaveBeenCalledWith({
      content: '<html/>',
      deviceId: 'dev-1',
      path: '/ws/.lobe-artifacts/site/index.html',
      workingDirectory: '/ws',
    });
  });

  it('throws the transport error when a copy is refused', async () => {
    vi.mocked(projectFileService.copyAssetForPublish).mockResolvedValue({
      error: 'Destination is outside the approved workspace',
      success: false,
    });
    const ops = createWorkspaceHtmlPublishFileOps({ workingDirectory: '/ws' });

    await expect(ops.copyFile('/outside/logo.png', '/elsewhere/logo.png')).rejects.toThrow(
      'Destination is outside the approved workspace',
    );
  });

  it('routes sandbox files through shell copy and writeFile tools', async () => {
    vi.mocked(cloudSandboxService.callTool).mockResolvedValue({ result: {}, success: true });
    const ops = createWorkspaceHtmlPublishFileOps({
      sandboxTopicId: 'topic-1',
      workingDirectory: '/ws',
    });

    await ops.copyFile("/outside/it's.png", '/ws/.lobe-artifacts/site/logo.png');
    await ops.writeFile('/ws/.lobe-artifacts/site/index.html', '<html/>');

    expect(cloudSandboxService.callTool).toHaveBeenNthCalledWith(
      1,
      'runCommand',
      expect.objectContaining({
        command: `mkdir -p '/ws/.lobe-artifacts/site' && cp '/outside/it'\\''s.png' '/ws/.lobe-artifacts/site/logo.png'`,
      }),
      { topicId: 'topic-1' },
    );
    expect(cloudSandboxService.callTool).toHaveBeenNthCalledWith(
      2,
      'writeFile',
      { content: '<html/>', createDirectories: true, path: '/ws/.lobe-artifacts/site/index.html' },
      { topicId: 'topic-1' },
    );
  });
});
