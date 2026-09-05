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
    delete process.env.TENCENT_SANDBOX_API_BASE;
    delete process.env.TENCENT_SANDBOX_API_TOKEN;
    delete process.env.TENCENT_SANDBOX_MODE;
    delete process.env.TENCENT_SANDBOX_PROJECT_ID;
    delete process.env.TENCENT_SANDBOX_REGION;
    delete process.env.TENCENT_SANDBOX_TIMEOUT_SEC;
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

  it('should leave the Tencent sandbox mode unset so the provider default applies', async () => {
    const { getSandboxConfig } = await import('../sandbox');

    expect(getSandboxConfig().TENCENT_SANDBOX_MODE).toBeUndefined();
  });

  it('should parse Tencent sandbox values', async () => {
    process.env.SANDBOX_PROVIDER = 'tencent';
    process.env.TENCENT_SANDBOX_API_BASE = 'https://pages-api.edgeone.ai/v1/sandbox';
    process.env.TENCENT_SANDBOX_API_TOKEN = 'edgeone-token';
    process.env.TENCENT_SANDBOX_MODE = 'on-demand';
    process.env.TENCENT_SANDBOX_PROJECT_ID = 'makers-test';
    process.env.TENCENT_SANDBOX_REGION = 'ap-singapore';
    process.env.TENCENT_SANDBOX_TIMEOUT_SEC = '900';

    const { getSandboxConfig } = await import('../sandbox');
    const config = getSandboxConfig();

    expect(config.SANDBOX_PROVIDER).toBe('tencent');
    expect(config.TENCENT_SANDBOX_API_BASE).toBe('https://pages-api.edgeone.ai/v1/sandbox');
    expect(config.TENCENT_SANDBOX_API_TOKEN).toBe('edgeone-token');
    expect(config.TENCENT_SANDBOX_MODE).toBe('on-demand');
    expect(config.TENCENT_SANDBOX_PROJECT_ID).toBe('makers-test');
    expect(config.TENCENT_SANDBOX_REGION).toBe('ap-singapore');
    expect(config.TENCENT_SANDBOX_TIMEOUT_SEC).toBe(900);
  });

  it.each(['299', '3601'])('should reject Tencent sandbox timeout %s', async (timeout) => {
    process.env.TENCENT_SANDBOX_TIMEOUT_SEC = timeout;

    await expect(import('../sandbox')).rejects.toThrow('Invalid environment variables');
  });
});
