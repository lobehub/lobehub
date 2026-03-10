import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerSandboxService } from './index';

describe('ServerSandboxService', () => {
  const runBuildInTool = vi.fn();
  const exportFile = vi.fn();

  const fileService = {
    createFileRecord: vi.fn(),
  } as any;

  const marketService = {
    exportFile,
    getSDK: () => ({
      plugins: {
        runBuildInTool,
      },
    }),
  } as any;

  beforeEach(() => {
    runBuildInTool.mockReset();
    exportFile.mockReset();
  });

  it('should inject referenced env vars from keyVaults for runCommand', async () => {
    runBuildInTool.mockResolvedValue({ success: true, data: { result: { ok: true } } });

    const service = new ServerSandboxService({
      fileService,
      keyVaults: {
        moltbook: {
          apiKey: 'moltbook_xxx',
          baseURL: 'https://www.moltbook.com/api/v1',
        },
        search1api: {
          apiKey: 'search_key_should_not_inject',
        },
      },
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    await service.callTool('runCommand', {
      command:
        'curl -H "Authorization: Bearer $MOLTBOOK_API_KEY" "$MOLTBOOK_BASE_URL/home" && echo done',
      description: 'heartbeat',
    });

    const command = runBuildInTool.mock.calls[0][1].command as string;

    expect(command).toContain("export MOLTBOOK_API_KEY='moltbook_xxx';");
    expect(command).toContain("export MOLTBOOK_BASE_URL='https://www.moltbook.com/api/v1';");
    expect(command).not.toContain('SEARCH1API_API_KEY');
  });

  it('should prefer explicit sandbox env values over flattened keyVaults', async () => {
    runBuildInTool.mockResolvedValue({ success: true, data: { result: { ok: true } } });

    const service = new ServerSandboxService({
      fileService,
      keyVaults: {
        moltbook: {
          apiKey: 'moltbook_from_flatten',
        },
        sandboxEnv: {
          MOLTBOOK_API_KEY: 'moltbook_from_explicit',
        },
      },
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    await service.callTool('runCommand', {
      command: 'curl -H "Authorization: Bearer $MOLTBOOK_API_KEY" https://example.com',
      description: 'heartbeat',
    });

    const command = runBuildInTool.mock.calls[0][1].command as string;

    expect(command).toContain("export MOLTBOOK_API_KEY='moltbook_from_explicit';");
    expect(command).not.toContain('moltbook_from_flatten');
  });

  it('should block runCommand when credential-like env var is missing', async () => {
    const service = new ServerSandboxService({
      fileService,
      keyVaults: {
        sandboxEnv: {
          OTHER_TOKEN: 'exists',
        },
      },
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await service.callTool('runCommand', {
      command: 'curl -H "Authorization: Bearer $MOLTBOOK_API_KEY" https://example.com',
      description: 'heartbeat',
    });

    expect(result.success).toBe(false);
    expect(result.error?.name).toBe('MissingCredentialEnv');
    expect(result.error?.message).toContain('MOLTBOOK_API_KEY');
    expect(result.error?.message).toContain('setCredential(path="moltbook.apiKey"');
    expect(result.error?.message).toContain('setCredential(path="sandboxEnv.MOLTBOOK_API_KEY"');
    expect(runBuildInTool).not.toHaveBeenCalled();
  });

  it('should not inject env vars for non-runCommand tools', async () => {
    runBuildInTool.mockResolvedValue({ success: true, data: { result: { files: [] } } });

    const service = new ServerSandboxService({
      fileService,
      keyVaults: {
        moltbook: {
          apiKey: 'moltbook_xxx',
        },
      },
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    await service.callTool('listLocalFiles', { directoryPath: '/' });

    expect(runBuildInTool).toHaveBeenCalledWith(
      'listLocalFiles',
      { directoryPath: '/' },
      expect.objectContaining({ topicId: 'topic-1', userId: 'user-1' }),
    );
  });
});
