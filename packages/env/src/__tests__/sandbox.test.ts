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
    delete process.env.BOXD_API_KEY;
    delete process.env.BOXD_BASE_URL;
    delete process.env.BOXD_LEASE_TTL_SEC;
    delete process.env.BOXD_REGION;
    delete process.env.BOXD_SNAPSHOT;
    delete process.env.BOXD_VCPU;
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

  it('should parse boxd sandbox values', async () => {
    process.env.SANDBOX_PROVIDER = 'boxd';
    process.env.BOXD_API_KEY = 'bxd_test';
    process.env.BOXD_BASE_URL = 'https://boxd.example.com';
    process.env.BOXD_LEASE_TTL_SEC = '0';
    process.env.BOXD_REGION = 'nyc';
    process.env.BOXD_SNAPSHOT = 'lobehub-base';
    process.env.BOXD_VCPU = '4';

    const { getSandboxConfig } = await import('../sandbox');
    const config = getSandboxConfig();

    expect(config.SANDBOX_PROVIDER).toBe('boxd');
    expect(config.BOXD_API_KEY).toBe('bxd_test');
    expect(config.BOXD_BASE_URL).toBe('https://boxd.example.com');
    expect(config.BOXD_LEASE_TTL_SEC).toBe(0);
    expect(config.BOXD_REGION).toBe('nyc');
    expect(config.BOXD_SNAPSHOT).toBe('lobehub-base');
    expect(config.BOXD_VCPU).toBe(4);
  });

  it('should treat docker empty string defaults as unset boxd values', async () => {
    process.env.BOXD_API_KEY = '';
    process.env.BOXD_BASE_URL = '';
    process.env.BOXD_LEASE_TTL_SEC = '';
    process.env.BOXD_REGION = '';
    process.env.BOXD_SNAPSHOT = '';
    process.env.BOXD_VCPU = '';

    const { getSandboxConfig } = await import('../sandbox');
    const config = getSandboxConfig();

    expect(config.BOXD_API_KEY).toBeUndefined();
    expect(config.BOXD_BASE_URL).toBeUndefined();
    expect(config.BOXD_LEASE_TTL_SEC).toBeUndefined();
    expect(config.BOXD_REGION).toBeUndefined();
    expect(config.BOXD_SNAPSHOT).toBeUndefined();
    expect(config.BOXD_VCPU).toBeUndefined();
  });

  it('should reject a boxd computer size that does not exist', async () => {
    process.env.BOXD_VCPU = '3';

    await expect(import('../sandbox')).rejects.toThrow('Invalid environment variables');
  });
});
