import { afterEach, describe, expect, it, vi } from 'vitest';

describe('branding env configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to Panachat when no env vars are set', async () => {
    const {
      BRANDING_NAME,
      BRANDING_NAME_FA,
      ORG_NAME,
      BRANDING_CLOUD_NAME,
      BRANDING_CLOUD_NAME_FA,
      BRANDING_LOGO_URL,
      getLocalizedBrandingName,
      getLocalizedBrandingInboxName,
    } = await import('./branding');

    expect(BRANDING_NAME).toBe('Panachat');
    expect(BRANDING_NAME_FA).toBe('پاناچت');
    expect(ORG_NAME).toBe('Panachat');
    expect(BRANDING_CLOUD_NAME).toBe('Panachat Cloud');
    expect(BRANDING_CLOUD_NAME_FA).toBe('ابر پاناچت');
    expect(BRANDING_LOGO_URL).toBe('/icons/icon-192x192.png');
    expect(getLocalizedBrandingName('fa-IR')).toBe('پاناچت');
    expect(getLocalizedBrandingName('en-US')).toBe('Panachat');
    expect(getLocalizedBrandingInboxName('fa-IR')).toBe('پاناچت AI');
    expect(getLocalizedBrandingInboxName('en-US')).toBe('Panachat AI');
  });

  it('reads NEXT_PUBLIC_BRANDING_NAME for client-exposed overrides', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRANDING_NAME', 'Custom App');
    vi.stubEnv('NEXT_PUBLIC_ORG_NAME', 'Custom Org');
    vi.stubEnv('NEXT_PUBLIC_BRANDING_CLOUD_NAME', 'Custom Cloud');
    vi.stubEnv('NEXT_PUBLIC_BRANDING_NAME_FA', 'اپ سفارشی');

    const { BRANDING_NAME, ORG_NAME, BRANDING_CLOUD_NAME, BRANDING_NAME_FA } =
      await import('./branding');

    expect(BRANDING_NAME).toBe('Custom App');
    expect(ORG_NAME).toBe('Custom Org');
    expect(BRANDING_CLOUD_NAME).toBe('Custom Cloud');
    expect(BRANDING_NAME_FA).toBe('اپ سفارشی');
  });

  it('leaves Reply-To unset by default for self-hosted deployments', async () => {
    const { BRANDING_EMAIL } = await import('./branding');

    expect(BRANDING_EMAIL.replyTo).toBeUndefined();
  });
});
