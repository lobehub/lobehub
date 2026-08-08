import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isCustomBranding: true,
}));

vi.mock('@/const/version', () => ({
  get isCustomBranding() {
    return mocks.isCustomBranding;
  },
}));

describe('isProfileChangeEmailEnabled', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns false for custom branding (Aico/Panachat)', async () => {
    mocks.isCustomBranding = true;
    const { isProfileChangeEmailEnabled } = await import('./isProfileChangeEmailEnabled');
    expect(isProfileChangeEmailEnabled()).toBe(false);
  });

  it('returns true when branding is not customized', async () => {
    mocks.isCustomBranding = false;
    const { isProfileChangeEmailEnabled } = await import('./isProfileChangeEmailEnabled');
    expect(isProfileChangeEmailEnabled()).toBe(true);
  });
});
