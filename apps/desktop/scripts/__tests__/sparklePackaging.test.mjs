import { describe, expect, it } from 'vitest';

import { resolveSparklePackaging } from '../sparklePackaging.mjs';

const settings = {
  sparklePublicKey: 'public-key',
  updateServerUrl: 'https://updates.example.com',
};

describe('resolveSparklePackaging', () => {
  it('packages Sparkle for signed stable, canary and beta macOS releases', () => {
    for (const channel of ['stable', 'canary', 'beta', undefined]) {
      expect(
        resolveSparklePackaging({
          channel,
          hasAppleCertificate: true,
          platform: 'darwin',
          ...settings,
        }),
      ).toEqual({ useSparkle: true });
    }
  });

  it('skips Sparkle on signed nightly macOS builds that lack the public key', () => {
    expect(
      resolveSparklePackaging({
        channel: 'nightly',
        hasAppleCertificate: true,
        platform: 'darwin',
        sparklePublicKey: undefined,
        updateServerUrl: 'https://updates.example.com',
      }),
    ).toEqual({ useSparkle: false });
  });

  it('does not package Sparkle on nightly even when settings are present', () => {
    expect(
      resolveSparklePackaging({
        channel: 'nightly',
        hasAppleCertificate: true,
        platform: 'darwin',
        ...settings,
      }),
    ).toEqual({ useSparkle: false });
  });

  it('rejects signed stable/canary/beta macOS builds that are missing Sparkle settings', () => {
    expect(() =>
      resolveSparklePackaging({
        channel: 'stable',
        hasAppleCertificate: true,
        platform: 'darwin',
        sparklePublicKey: undefined,
        updateServerUrl: 'https://updates.example.com',
      }),
    ).toThrow(/UPDATE_SERVER_URL and SPARKLE_ED_PUBLIC_KEY/);

    expect(() =>
      resolveSparklePackaging({
        channel: 'canary',
        hasAppleCertificate: true,
        platform: 'darwin',
        sparklePublicKey: 'public-key',
        updateServerUrl: undefined,
      }),
    ).toThrow(/UPDATE_SERVER_URL and SPARKLE_ED_PUBLIC_KEY/);
  });

  it('allows unsigned macOS and non-darwin builds without Sparkle settings', () => {
    expect(
      resolveSparklePackaging({
        channel: 'stable',
        hasAppleCertificate: false,
        platform: 'darwin',
        sparklePublicKey: undefined,
        updateServerUrl: undefined,
      }),
    ).toEqual({ useSparkle: false });

    expect(
      resolveSparklePackaging({
        channel: 'stable',
        hasAppleCertificate: true,
        platform: 'linux',
        sparklePublicKey: undefined,
        updateServerUrl: undefined,
      }),
    ).toEqual({ useSparkle: false });
  });
});
