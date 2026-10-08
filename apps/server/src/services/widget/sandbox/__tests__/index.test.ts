import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('createWidgetSandboxRunner', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('defaults to the Cloudflare Worker provider with the boolean network format', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: { WIDGET_SANDBOX_TOKEN: 'tok', WIDGET_SANDBOX_URL: 'https://w.example.dev' },
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ exitCode: 0, stderr: '', stdout: '' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchImpl);

    const { CloudflareWorkerSandboxRunner, createWidgetSandboxRunner } = await import('../index');
    const runner = createWidgetSandboxRunner();
    expect(runner).toBeInstanceOf(CloudflareWorkerSandboxRunner);

    await runner.run({
      env: {},
      network: { allow: ['api.github.com'] },
      runtime: 'node',
      script: 'x',
      subject: { id: 'w', kind: 'widget' },
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://w.example.dev/run');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).network).toBe(true);
    vi.unstubAllGlobals();
  });

  it('honors the allowlist network format', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        WIDGET_SANDBOX_NETWORK_FORMAT: 'allowlist',
        WIDGET_SANDBOX_PROVIDER: 'cloudflare-worker',
        WIDGET_SANDBOX_TOKEN: 'tok',
        WIDGET_SANDBOX_URL: 'https://w.example.dev',
      },
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ exitCode: 0, stderr: '', stdout: '' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchImpl);

    const { createWidgetSandboxRunner } = await import('../index');
    await createWidgetSandboxRunner().run({
      env: {},
      network: { allow: ['api.github.com'] },
      runtime: 'node',
      script: 'x',
      subject: { id: 'w', kind: 'widget' },
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).network).toEqual({
      allow: ['api.github.com'],
    });
    vi.unstubAllGlobals();
  });
});
