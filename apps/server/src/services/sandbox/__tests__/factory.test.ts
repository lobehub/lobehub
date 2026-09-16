import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

const baseOptions = {
  marketService: {} as MarketService,
  topicId: 'topic-1',
  userId: 'user-1',
};

describe('sandbox service factory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the market provider by default', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {},
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('market');
    expect(service.capabilities).toMatchObject({
      backgroundCommands: true,
      exportFile: true,
      files: true,
      persistentSession: true,
      shell: true,
      skillScripts: true,
    });
  });

  it('uses the onlyboxes provider when configured', async () => {
    vi.doMock('@/envs/app', () => ({
      appEnv: {
        APP_URL: 'https://lobehub.example.com',
      },
    }));
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        ONLYBOXES_BASE_URL: 'https://onlyboxes.example.com',
        ONLYBOXES_JIT_SIGNING_KEY: 'jit-signing-key',
        SANDBOX_PROVIDER: 'onlyboxes',
      },
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('onlyboxes');
    expect(service.capabilities.languages).toEqual(['python', 'javascript', 'typescript']);
  });

  it('uses the Tencent provider when configured', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        SANDBOX_PROVIDER: 'tencent',
        TENCENT_SANDBOX_API_TOKEN: 'edgeone-token',
        TENCENT_SANDBOX_MODE: 'persistent',
        TENCENT_SANDBOX_PROJECT_ID: 'makers-test',
      },
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('tencent');
    expect(service.capabilities).toMatchObject({
      backgroundCommands: true,
      files: true,
      persistentSession: true,
      skillScripts: false,
    });
  });

  it('reserves the upcoming Tencent operation before file initialization', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));

    const commandsRun = vi.fn(async () => {
      if (commandsRun.mock.calls.length === 1) {
        // Exercise the full bootstrap allowance. The following 300-second
        // command must still fit in the acquired on-demand instance.
        vi.setSystemTime(Date.now() + 120_000);
      }

      return { exitCode: 0, stderr: '', stdout: '{}' };
    });
    const filesWrite = vi.fn();
    const controlPlaneRequests: { action: string; payload: Record<string, unknown> }[] = [];

    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        SANDBOX_PROVIDER: 'tencent',
        TENCENT_SANDBOX_API_TOKEN: 'edgeone-token',
        TENCENT_SANDBOX_MODE: 'on-demand',
        TENCENT_SANDBOX_PROJECT_ID: 'makers-test',
      },
    }));
    vi.doMock('@e2b/code-interpreter', () => ({
      Sandbox: vi.fn(() => ({
        commands: { run: commandsRun },
        files: { write: filesWrite },
      })),
    }));
    vi.doMock('@/database/models/file', () => ({
      FileModel: vi.fn(() => ({
        findFilesToInitInSandbox: vi.fn(async () => [
          { fileType: 'text/csv', id: 'f1', name: 'data.csv', size: 10, url: 'key-1' },
        ]),
      })),
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const payload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        controlPlaneRequests.push({ action: url.split('/').pop() || '', payload });
        const timeoutSec = Number(payload.Timeout);

        return new Response(
          JSON.stringify({
            Code: 0,
            Data: {
              InstanceExpiresAt: new Date(Date.now() + timeoutSec * 1000).toISOString(),
              InstanceId: 'instance-1',
              SandboxDomain: 'ap-beijing.tencentags.com',
              Token: 'sit_test',
            },
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        );
      }),
    );

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService({
      ...baseOptions,
      fileService: {
        createCachedPreSignedUrlForPreview: vi.fn(
          async () => 'https://download.example.com/data.csv',
        ),
      } as never,
      serverDB: {} as never,
    });
    const params = { background: true, command: 'sleep 1', timeout: 300_000 };

    const result = await service.callTool('runCommand', params);

    expect(result.success).toBe(true);
    expect(controlPlaneRequests).toEqual([
      { action: 'acquire', payload: expect.objectContaining({ Timeout: 480 }) },
    ]);
    expect(commandsRun).toHaveBeenNthCalledWith(1, expect.stringContaining('curl'), {
      timeoutMs: 120_000,
    });
    expect(commandsRun).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('directory.mkdir(parents=True, exist_ok=True)'),
      { timeoutMs: 10_000 },
    );
    expect(commandsRun).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('timeout --kill-after=5s 300s'),
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
  });
});
