import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadDeployment = async (sandboxEnv: Record<string, unknown>) => {
  vi.doMock('@/envs/sandbox', () => ({ sandboxEnv }));
  return import('./deployment');
};

describe('getSandboxDeployment', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('defaults to market', async () => {
    const { getSandboxDeployment } = await loadDeployment({});

    expect(getSandboxDeployment()).toBe('market');
  });

  it('reports boxd when its API key is set', async () => {
    const { getSandboxDeployment } = await loadDeployment({
      BOXD_API_KEY: 'bxd_test',
      SANDBOX_PROVIDER: 'boxd',
    });

    expect(getSandboxDeployment()).toBe('boxd');
  });

  it('reports boxd without an API key as unconfigured instead of falling back to market', async () => {
    const { getSandboxDeployment } = await loadDeployment({ SANDBOX_PROVIDER: 'boxd' });

    expect(getSandboxDeployment()).toBe('unconfigured');
  });

  it('keeps reporting a half-configured onlyboxes as unconfigured', async () => {
    const { getSandboxDeployment } = await loadDeployment({
      ONLYBOXES_BASE_URL: 'https://onlyboxes.example.com',
      SANDBOX_PROVIDER: 'onlyboxes',
    });

    expect(getSandboxDeployment()).toBe('unconfigured');
  });
});
