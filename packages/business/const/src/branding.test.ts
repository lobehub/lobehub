import { afterEach, describe, expect, it, vi } from 'vitest';

describe('branding env configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to Aico when no env vars are set', async () => {
    const { BRANDING_NAME, ORG_NAME, BRANDING_CLOUD_NAME, BRANDING_LOGO_URL } =
      await import('./branding');

    expect(BRANDING_NAME).toBe('Aico');
    expect(ORG_NAME).toBe('Aico');
    expect(BRANDING_CLOUD_NAME).toBe('Aico Cloud');
    expect(BRANDING_LOGO_URL).toBe('/icons/icon-192x192.png');
  });

  it('reads NEXT_PUBLIC_BRANDING_NAME for client-exposed overrides', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRANDING_NAME', 'Custom App');
    vi.stubEnv('NEXT_PUBLIC_ORG_NAME', 'Custom Org');
    vi.stubEnv('NEXT_PUBLIC_BRANDING_CLOUD_NAME', 'Custom Cloud');

    const { BRANDING_NAME, ORG_NAME, BRANDING_CLOUD_NAME } = await import('./branding');

    expect(BRANDING_NAME).toBe('Custom App');
    expect(ORG_NAME).toBe('Custom Org');
    expect(BRANDING_CLOUD_NAME).toBe('Custom Cloud');
  });

  it('leaves Reply-To unset by default for self-hosted deployments', async () => {
    const { BRANDING_EMAIL } = await import('./branding');

    expect(BRANDING_EMAIL.replyTo).toBeUndefined();
  });
});
