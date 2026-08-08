import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineConfig } from './define-config';

describe('defineConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('disables Next.js agent rule injection', () => {
    expect(defineConfig({}).agentRules).toBe(false);
  });

  it('enables frame protections when ENABLED_CSP is unset', async () => {
    vi.stubEnv('ENABLED_CSP', undefined);

    const headers = await defineConfig({}).headers?.();
    const securityHeaders = headers?.find(({ source }) => source === '/:path*')?.headers;

    expect(securityHeaders).toEqual(
      expect.arrayContaining([
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
      ]),
    );
  });

  it('allows frame protections to be explicitly disabled', async () => {
    vi.stubEnv('ENABLED_CSP', '0');

    const headers = await defineConfig({}).headers?.();
    const securityHeaders = headers?.find(({ source }) => source === '/:path*')?.headers;
    const securityHeaderKeys = securityHeaders?.map(({ key }) => key);

    expect(securityHeaderKeys).not.toContain('X-Frame-Options');
    expect(securityHeaderKeys).not.toContain('Content-Security-Policy');
  });
});
