// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getSandboxConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SANDBOX_PROVIDER;
    delete process.env.ONLYBOXES_BASE_URL;
    delete process.env.ONLYBOXES_JIT_ISSUER;
    delete process.env.ONLYBOXES_JIT_SIGNING_KEY;
    delete process.env.ONLYBOXES_JIT_TTL_SEC;
    delete process.env.ONLYBOXES_LEASE_TTL_SEC;
    for (const key of [
      'WIDGET_SANDBOX_URL',
      'WIDGET_SANDBOX_TOKEN',
      'WIDGET_SANDBOX_PROVIDER',
      'WIDGET_SANDBOX_NETWORK_FORMAT',
      'DASHBOARD_SANDBOX_URL',
      'DASHBOARD_SANDBOX_TOKEN',
    ]) {
      delete process.env[key];
    }
  });

  it('should treat docker empty string defaults as unset optional values', async () => {
    process.env.SANDBOX_PROVIDER = '';
    process.env.ONLYBOXES_BASE_URL = '';
    process.env.ONLYBOXES_JIT_ISSUER = '';
    process.env.ONLYBOXES_JIT_SIGNING_KEY = '';
    process.env.ONLYBOXES_JIT_TTL_SEC = '';
    process.env.ONLYBOXES_LEASE_TTL_SEC = '';

    const { getSandboxConfig } = await import('../sandbox');
    const config = getSandboxConfig();

    expect(config.SANDBOX_PROVIDER).toBeUndefined();
    expect(config.ONLYBOXES_BASE_URL).toBeUndefined();
    expect(config.ONLYBOXES_JIT_ISSUER).toBeUndefined();
    expect(config.ONLYBOXES_JIT_SIGNING_KEY).toBeUndefined();
    expect(config.ONLYBOXES_JIT_TTL_SEC).toBeUndefined();
    expect(config.ONLYBOXES_LEASE_TTL_SEC).toBeUndefined();
  });

  it('should parse configured sandbox values', async () => {
    process.env.SANDBOX_PROVIDER = 'onlyboxes';
    process.env.ONLYBOXES_BASE_URL = 'https://onlyboxes.example.com';
    process.env.ONLYBOXES_JIT_ISSUER = 'lobehub-test';
    process.env.ONLYBOXES_JIT_SIGNING_KEY = 'jit-signing-key';
    process.env.ONLYBOXES_JIT_TTL_SEC = '900';
    process.env.ONLYBOXES_LEASE_TTL_SEC = '3600';

    const { getSandboxConfig } = await import('../sandbox');
    const config = getSandboxConfig();

    expect(config.SANDBOX_PROVIDER).toBe('onlyboxes');
    expect(config.ONLYBOXES_BASE_URL).toBe('https://onlyboxes.example.com');
    expect(config.ONLYBOXES_JIT_ISSUER).toBe('lobehub-test');
    expect(config.ONLYBOXES_JIT_SIGNING_KEY).toBe('jit-signing-key');
    expect(config.ONLYBOXES_JIT_TTL_SEC).toBe(900);
    expect(config.ONLYBOXES_LEASE_TTL_SEC).toBe(3600);
  });

  it('reads the widget sandbox from WIDGET_SANDBOX_*', async () => {
    process.env.WIDGET_SANDBOX_URL = 'https://widget.example.dev';
    process.env.WIDGET_SANDBOX_TOKEN = 'widget-token';
    process.env.WIDGET_SANDBOX_PROVIDER = 'cloudflare-worker';
    process.env.WIDGET_SANDBOX_NETWORK_FORMAT = 'boolean';
    process.env.DASHBOARD_SANDBOX_URL = 'https://legacy.example.dev';
    process.env.DASHBOARD_SANDBOX_TOKEN = 'legacy-token';

    const { getSandboxConfig } = await import('../sandbox');
    const config = getSandboxConfig();

    expect(config.WIDGET_SANDBOX_URL).toBe('https://widget.example.dev');
    expect(config.WIDGET_SANDBOX_TOKEN).toBe('widget-token');
    expect(config.WIDGET_SANDBOX_PROVIDER).toBe('cloudflare-worker');
    expect(config.WIDGET_SANDBOX_NETWORK_FORMAT).toBe('boolean');
  });

  it('falls back to the legacy DASHBOARD_SANDBOX_* names', async () => {
    process.env.DASHBOARD_SANDBOX_URL = 'https://legacy.example.dev';
    process.env.DASHBOARD_SANDBOX_TOKEN = 'legacy-token';

    const { getSandboxConfig } = await import('../sandbox');
    const config = getSandboxConfig();

    expect(config.WIDGET_SANDBOX_URL).toBe('https://legacy.example.dev');
    expect(config.WIDGET_SANDBOX_TOKEN).toBe('legacy-token');
    expect(config.WIDGET_SANDBOX_PROVIDER).toBeUndefined();
  });
});
