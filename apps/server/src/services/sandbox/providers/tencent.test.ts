// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    TENCENT_SANDBOX_API_BASE: undefined as string | undefined,
    TENCENT_SANDBOX_API_TOKEN: 'test-token' as string | undefined,
    TENCENT_SANDBOX_MODE: 'persistent' as string,
    TENCENT_SANDBOX_PROJECT_ID: 'makers-test' as string | undefined,
    TENCENT_SANDBOX_REGION: undefined as string | undefined,
    TENCENT_SANDBOX_TIMEOUT_SEC: undefined as number | undefined,
  },
  sandbox: {
    commands: { connect: vi.fn(), kill: vi.fn(), run: vi.fn() },
    files: { list: vi.fn(), read: vi.fn(), write: vi.fn() },
    runCode: vi.fn(),
  },
}));

vi.mock('@/envs/sandbox', () => ({ sandboxEnv: mocks.env }));
vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: vi.fn(() => mocks.sandbox),
}));

const options = { marketService: {} as never, topicId: 'topic-1', userId: 'user-1' };

/** Counts how many times each control-plane action was called. */
const calls = { acquire: 0, release: 0, update: 0 };

const install = () => {
  calls.acquire = 0;
  calls.release = 0;
  calls.update = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const action = url.split('/').pop() as keyof typeof calls;
      calls[action] += 1;

      return {
        json: async () => ({
          Code: 0,
          Data: {
            InstanceExpiresAt: new Date(Date.now() + 300_000).toISOString(),
            InstanceId: `instance-${calls.acquire}`,
            SandboxDomain: 'ap-beijing.tencentags.com',
            Token: 'sit_test',
          },
        }),
        ok: true,
      };
    }),
  );
};

const load = async () => {
  vi.resetModules();
  const { TencentSandboxProvider } = await import('./tencent');

  return new TencentSandboxProvider(options);
};

describe('TencentSandboxProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.TENCENT_SANDBOX_API_TOKEN = 'test-token';
    mocks.env.TENCENT_SANDBOX_PROJECT_ID = 'makers-test';
    mocks.env.TENCENT_SANDBOX_MODE = 'persistent';
    install();
  });

  it('fails fast when credentials are missing', async () => {
    mocks.env.TENCENT_SANDBOX_API_TOKEN = undefined;

    const result = await (await load()).callTool('executeCode', { code: 'print(1)' });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('TENCENT_SANDBOX_API_TOKEN');
    // No instance should be acquired when the provider is not configured.
    expect(calls.acquire).toBe(0);
  });

  it('runs code and returns stdout', async () => {
    mocks.sandbox.runCode.mockResolvedValue({
      logs: { stderr: [], stdout: ['42\n'] },
      results: [],
    });

    const result = await (await load()).callTool('executeCode', { code: 'print(42)' });

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ stdout: '42\n' });
  });

  // Persistence is the whole point of the default mode: a second tool call in
  // the same topic must land in the container the first one created.
  it('reuses one instance across calls in persistent mode', async () => {
    mocks.sandbox.runCode.mockResolvedValue({ logs: { stderr: [], stdout: [''] }, results: [] });

    const provider = await load();
    await provider.callTool('executeCode', { code: 'x = 1' });
    await provider.callTool('executeCode', { code: 'print(x)' });

    expect(calls.acquire).toBe(1);
    expect(calls.release).toBe(0);
  });

  it('acquires and releases per call in on-demand mode', async () => {
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';
    mocks.sandbox.runCode.mockResolvedValue({ logs: { stderr: [], stdout: [''] }, results: [] });

    const provider = await load();
    await provider.callTool('executeCode', { code: 'x = 1' });
    await provider.callTool('executeCode', { code: 'x = 2' });

    expect(calls.acquire).toBe(2);
    expect(calls.release).toBe(2);
  });

  it('releases the instance even when the tool throws', async () => {
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';
    mocks.sandbox.runCode.mockRejectedValue(new Error('boom'));

    const result = await (await load()).callTool('executeCode', { code: 'boom' });

    expect(result.success).toBe(false);
    expect(calls.release).toBe(1);
  });

  it('reports unsupported tools as a failed call', async () => {
    const result = await (await load()).callTool('notARealTool', {});

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('notARealTool');
  });

  it('reports capabilities that match the configured mode', async () => {
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';

    expect((await load()).capabilities.persistentSession).toBe(false);
  });
});
