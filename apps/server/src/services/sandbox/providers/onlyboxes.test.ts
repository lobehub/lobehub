import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

const decodeJITPayload = (authorization?: string) => {
  const token = authorization?.replace('Bearer ', '') || '';
  const [payload] = token.replace('obx_jit_v1.', '').split('.');

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    exp: number;
    iss: string;
    sub: string;
  };
};

const verifyJITSignature = (authorization?: string) => {
  const token = authorization?.replace('Bearer ', '') || '';
  const [signed, signature] = token.split(/\.(?=[^.]+$)/);
  const expected = createHmac('sha256', 'jit-signing-key').update(signed).digest('base64url');

  return signature === expected;
};

describe('OnlyboxesSandboxProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.setSystemTime(new Date('2026-05-30T00:00:00.000Z'));
    vi.doMock('@/envs/app', () => ({
      appEnv: {
        APP_URL: 'https://lobehub.example.com',
      },
    }));
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        ONLYBOXES_BASE_URL: 'https://onlyboxes.example.com/',
        ONLYBOXES_JIT_SIGNING_KEY: 'jit-signing-key',
        ONLYBOXES_JIT_TTL_SEC: 900,
        ONLYBOXES_LEASE_TTL_SEC: 120,
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps runCommand to the terminal command endpoint with a persistent session', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          exit_code: 0,
          session_id: 'lobe-user-1-topic-1',
          stderr: '',
          stdout: 'ok\n',
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('runCommand', { command: 'echo ok' });

    expect(result).toMatchObject({
      result: { exitCode: 0, stdout: 'ok\n' },
      success: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://onlyboxes.example.com/api/v1/commands/terminal',
      expect.objectContaining({
        body: JSON.stringify({
          command: 'echo ok',
          create_if_missing: true,
          lease_ttl_sec: 120,
          session_id: 'lobe-user-1-topic-1',
          timeout_ms: 120_000,
        }),
        method: 'POST',
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Headers;
    const authorization = headers.get('Authorization') || undefined;
    expect(authorization).toMatch(/^Bearer obx_jit_v1\./);
    expect(verifyJITSignature(authorization)).toBe(true);
    expect(decodeJITPayload(authorization)).toEqual({
      exp: Date.parse('2026-05-30T00:15:00.000Z'),
      iss: 'https://lobehub.example.com',
      sub: 'user-1',
    });
  });

  it('treats non-zero terminal exit codes as successful tool transport results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            exit_code: 2,
            session_id: 'lobe-user-1-topic-1',
            stderr: 'failed\n',
            stdout: 'partial\n',
          }),
          { status: 200 },
        );
      }),
    );

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('runCommand', { command: 'exit 2' });

    expect(result).toMatchObject({
      result: {
        exitCode: 2,
        stderr: 'failed\n',
        stdout: 'partial\n',
        success: false,
      },
      success: true,
    });
  });

  it('returns a provider error when background command submission fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'no_worker',
              message: 'no compatible worker',
            },
            status: 'failed',
          }),
          { status: 200 },
        );
      }),
    );

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('runCommand', {
      background: true,
      command: 'sleep 10',
    });

    expect(result).toMatchObject({
      error: { message: 'no compatible worker' },
      result: null,
      success: false,
    });
  });

  it('treats running background command polls as successful output retrievals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            result: {
              stdout: 'partial\n',
            },
            status: 'running',
            task_id: 'task-1',
          }),
          { status: 200 },
        );
      }),
    );

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('getCommandOutput', { commandId: 'task-1' });

    expect(result).toMatchObject({
      result: {
        newOutput: 'partial\n',
        running: true,
        success: true,
      },
      success: true,
    });
  });

  it('unwraps JSON output from terminal-backed file operations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: JSON.stringify({
              files: [{ isDirectory: false, name: 'a.txt' }],
              totalCount: 1,
            }),
          }),
          { status: 200 },
        );
      }),
    );

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('listLocalFiles', { directoryPath: '/workspace' });

    expect(result).toMatchObject({
      result: {
        files: [{ isDirectory: false, name: 'a.txt' }],
        totalCount: 1,
      },
      success: true,
    });
  });

  it('writes files through chunked terminal scripts instead of embedding content in one command', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: JSON.stringify({ success: true }),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: JSON.stringify({ bytesWritten: 11, success: true }),
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('writeLocalFile', {
      content: 'hello world',
      createDirectories: true,
      path: '/workspace/report.txt',
    });

    expect(result).toMatchObject({
      result: { bytesWritten: 11, success: true },
      success: true,
    });
    const firstCallBody = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      command: string;
    };
    const secondCallBody = JSON.parse(String(fetchMock.mock.calls[1][1].body)) as {
      command: string;
    };
    expect(firstCallBody.command).toContain("path.write_bytes(b'')");
    expect(secondCallBody.command).toContain("path.open('ab')");
    expect(firstCallBody.command).not.toContain('hello world');
    expect(secondCallBody.command).not.toContain('hello world');
  });

  it('ensures a terminal session exists before exporting files through terminalResource', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: '',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              file_path: '/workspace/report.txt',
              mime_type: 'text/plain',
              session_id: 'lobe-user-1-topic-1',
              size_bytes: 12,
            },
            status: 'succeeded',
            task_id: 'task-1',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.exportFileToUploadUrl({
      filename: 'report.txt',
      path: '/workspace/report.txt',
      uploadHeaders: { 'x-amz-acl': 'public-read' },
      uploadUrl: 'https://uploads.example.com/put',
    });

    expect(result).toMatchObject({
      mimeType: 'text/plain',
      success: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://onlyboxes.example.com/api/v1/commands/terminal',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://onlyboxes.example.com/api/v1/tasks',
      expect.objectContaining({
        body: JSON.stringify({
          capability: 'terminalResource',
          input: {
            action: 'export',
            file_path: '/workspace/report.txt',
            headers: { 'x-amz-acl': 'public-read' },
            session_id: 'lobe-user-1-topic-1',
            signed_url: 'https://uploads.example.com/put',
          },
          mode: 'sync',
          timeout_ms: 120_000,
          wait_ms: 60_000,
        }),
      }),
    );
  });

  it('runs execScript from a prepared skill directory when skill zip URLs are available', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: '',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: 'from skill\n',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('execScript', {
      activatedSkills: [{ id: 'skill-1', name: 'demo' }],
      command: 'python scripts/run.py',
      skillZipUrls: { demo: 'https://files.example.com/demo.zip' },
    });

    expect(result).toMatchObject({
      result: {
        stdout: 'from skill\n',
        success: true,
      },
      success: true,
    });

    const setupBody = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { command: string };
    const commandBody = JSON.parse(String(fetchMock.mock.calls[1][1].body)) as { command: string };
    expect(setupBody.command).toContain("curl -fsSL 'https://files.example.com/demo.zip'");
    expect(setupBody.command).toContain('unzip -q');
    expect(commandBody.command).toContain("cd '/tmp/lobe-skills/");
    expect(commandBody.command).toContain("/demo'");
    expect(commandBody.command).toContain('python scripts/run.py');
  });

  it('prepares all skill zip URLs and runs execScript from the last activated skill directory', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: '',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: 'from second skill\n',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('execScript', {
      activatedSkills: [
        { id: 'skill-1', name: 'first skill' },
        { id: 'skill-2', name: 'second/skill' },
      ],
      command: 'python scripts/run.py',
      skillZipUrls: {
        'first skill': 'https://files.example.com/first.zip',
        'second/skill': 'https://files.example.com/second.zip',
      },
    });

    expect(result).toMatchObject({
      result: {
        stdout: 'from second skill\n',
        success: true,
      },
      success: true,
    });

    const setupBody = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { command: string };
    const commandBody = JSON.parse(String(fetchMock.mock.calls[1][1].body)) as { command: string };
    expect(setupBody.command).toContain("curl -fsSL 'https://files.example.com/first.zip'");
    expect(setupBody.command).toContain("curl -fsSL 'https://files.example.com/second.zip'");
    expect(setupBody.command).toContain('/first-skill/');
    expect(setupBody.command).toContain('/second-skill/');
    expect(commandBody.command).toContain("cd '/tmp/lobe-skills/");
    expect(commandBody.command).toContain("/second-skill'");
    expect(commandBody.command).toContain('python scripts/run.py');
  });

  it('uses the configured skill name for legacy single zipUrl execScript calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: '',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exit_code: 0,
            session_id: 'lobe-user-1-topic-1',
            stderr: '',
            stdout: 'from legacy skill\n',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { OnlyboxesSandboxProvider } = await import('./onlyboxes');
    const provider = new OnlyboxesSandboxProvider({
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('execScript', {
      command: 'python scripts/run.py',
      config: { name: 'legacy skill' },
      zipUrl: 'https://files.example.com/legacy.zip',
    });

    expect(result).toMatchObject({
      result: {
        stdout: 'from legacy skill\n',
        success: true,
      },
      success: true,
    });

    const setupBody = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { command: string };
    const commandBody = JSON.parse(String(fetchMock.mock.calls[1][1].body)) as { command: string };
    expect(setupBody.command).toContain("curl -fsSL 'https://files.example.com/legacy.zip'");
    expect(setupBody.command).toContain('/legacy-skill/');
    expect(commandBody.command).toContain('/legacy-skill');
  });
});
