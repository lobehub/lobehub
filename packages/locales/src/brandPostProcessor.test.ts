import type * as Const from '@lobechat/const';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Branding {
  BRANDING_NAME: string;
  DEFAULT_INBOX_TITLE: string;
  LOBE_CHAT_CLOUD: string;
}

const UPSTREAM: Branding = {
  BRANDING_NAME: 'LobeHub',
  DEFAULT_INBOX_TITLE: 'Lobe AI',
  LOBE_CHAT_CLOUD: 'LobeHub Cloud',
};

const ACME: Branding = {
  BRANDING_NAME: 'Acme',
  DEFAULT_INBOX_TITLE: 'Acme AI',
  LOBE_CHAT_CLOUD: 'Acme Cloud',
};

// The replacement table is built at module scope from the branding constants,
// so each config needs a fresh copy of the module.
const loadWith = async (branding: Branding) => {
  vi.resetModules();
  vi.doMock('@lobechat/const', async (importOriginal) => ({
    ...(await importOriginal<typeof Const>()),
    ...branding,
  }));
  // Under vitest 5 a `doMock` only lands once the test file itself imports
  // something, so pull the mocked module in before the one under test.
  await import('@lobechat/const');

  return import('./brandPostProcessor');
};

afterEach(() => {
  vi.doUnmock('@lobechat/const');
});

describe('brandPostProcessor', () => {
  describe('under default branding', () => {
    it('is not enabled, so i18next never registers it', async () => {
      const { brandPostProcessOptions, isBrandPostProcessorEnabled } = await loadWith(UPSTREAM);

      expect(isBrandPostProcessorEnabled).toBe(false);
      expect(brandPostProcessOptions).toEqual({});
    });

    it('leaves every upstream literal as translated, including the pre-rename name', async () => {
      const { applyBrandStrings } = await loadWith(UPSTREAM);
      const copy = 'Ask Lobe AI · Sign in to LobeHub · LobeHub Cloud · LobeChat';

      expect(applyBrandStrings(copy)).toBe(copy);
    });
  });

  describe('under custom branding', () => {
    it('is enabled and asks i18next to run it', async () => {
      const { BRAND_POST_PROCESSOR, brandPostProcessOptions, isBrandPostProcessorEnabled } =
        await loadWith(ACME);

      expect(isBrandPostProcessorEnabled).toBe(true);
      expect(brandPostProcessOptions).toEqual({ postProcess: [BRAND_POST_PROCESSOR] });
    });

    it('rewrites the assistant name', async () => {
      const { applyBrandStrings } = await loadWith(ACME);

      expect(applyBrandStrings('Ask Lobe AI')).toBe('Ask Acme AI');
    });

    it('rewrites the product name', async () => {
      const { applyBrandStrings } = await loadWith(ACME);

      expect(applyBrandStrings('Sign in to LobeHub')).toBe('Sign in to Acme');
    });

    it('rewrites the pre-rename product name, still present in stale translations', async () => {
      const { applyBrandStrings } = await loadWith(ACME);

      expect(applyBrandStrings('LobeChat supports custom API keys')).toBe(
        'Acme supports custom API keys',
      );
    });

    it('prefers the hosted-service name over the bare product name', async () => {
      // Longest-first ordering: matching 'LobeHub' first would leave a dangling
      // ' Cloud' and make LOBE_CHAT_CLOUD unreachable from translated copy.
      const { applyBrandStrings } = await loadWith(ACME);

      expect(applyBrandStrings('or just use LobeHub Cloud')).toBe('or just use Acme Cloud');
    });

    it('falls back to "<brand> Cloud" when only the product was renamed', async () => {
      // The Cloud pair is then at its upstream default and gets dropped, so the
      // shorter rule takes over. Degraded, but still not a leak.
      const { applyBrandStrings } = await loadWith({ ...UPSTREAM, BRANDING_NAME: 'Acme' });

      expect(applyBrandStrings('or just use LobeHub Cloud')).toBe('or just use Acme Cloud');
    });

    it('rewrites only what was renamed', async () => {
      const { applyBrandStrings } = await loadWith({ ...UPSTREAM, DEFAULT_INBOX_TITLE: 'Acme AI' });

      expect(applyBrandStrings('Ask Lobe AI in LobeHub')).toBe('Ask Acme AI in LobeHub');
    });

    it('rewrites every occurrence in one string', async () => {
      const { applyBrandStrings } = await loadWith(ACME);

      expect(applyBrandStrings('Lobe AI and Lobe AI')).toBe('Acme AI and Acme AI');
    });

    it('leaves social handles alone', async () => {
      // '@LobeHub' is a Slack account that only exists under the upstream brand;
      // rewriting it would hand the user an address that does not resolve.
      const { applyBrandStrings } = await loadWith(ACME);

      expect(applyBrandStrings('DM @LobeHub on Slack to link your account')).toBe(
        'DM @LobeHub on Slack to link your account',
      );
    });

    it('leaves unrelated copy untouched', async () => {
      const { applyBrandStrings } = await loadWith(ACME);

      expect(applyBrandStrings('Start a new topic')).toBe('Start a new topic');
    });

    it('rewrites through the i18next post-processor entry point', async () => {
      const { brandPostProcessor } = await loadWith(ACME);

      expect(brandPostProcessor.process('Ask Lobe AI', '', {}, {} as any)).toBe('Ask Acme AI');
    });
  });
});
