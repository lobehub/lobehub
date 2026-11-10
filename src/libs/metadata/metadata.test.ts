// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
import { BRANDING_NAME } from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Meta } from './metadata';

describe('Metadata', () => {
  const meta = new Meta();

  describe('generate', () => {
    it('should generate metadata with default values', () => {
      const result = meta.generate({
        title: 'Test Title',
        url: 'https://example.com',
      });

      expect(result).toMatchObject({
        title: 'Test Title',
        description: expect.any(String),
        openGraph: expect.objectContaining({
          title: `Test Title · ${BRANDING_NAME}`,
          description: expect.any(String),
          images: [{ url: OG_URL, alt: `Test Title · ${BRANDING_NAME}` }],
        }),
        twitter: expect.objectContaining({
          title: `Test Title · ${BRANDING_NAME}`,
          description: expect.any(String),
          images: [OG_URL],
        }),
      });
    });

    it('should generate metadata with custom values', () => {
      const result = meta.generate({
        title: 'Custom Title',
        description: 'Custom description',
        image: 'https://custom-image.com',
        url: 'https://example.com/custom',
        type: 'article',
        tags: ['tag1', 'tag2'],
        locale: 'fr-FR',
        alternate: true,
      });

      expect(result).toMatchObject({
        title: 'Custom Title',
        description: expect.stringContaining('Custom description'),
        openGraph: expect.objectContaining({
          title: `Custom Title · ${BRANDING_NAME}`,
          description: 'Custom description',
          images: [{ url: 'https://custom-image.com', alt: `Custom Title · ${BRANDING_NAME}` }],
          type: 'article',
          locale: 'fr-FR',
        }),
        twitter: expect.objectContaining({
          title: `Custom Title · ${BRANDING_NAME}`,
          description: 'Custom description',
          images: ['https://custom-image.com'],
        }),
        alternates: expect.objectContaining({
          languages: expect.any(Object),
        }),
      });
    });
  });

  describe('genAlternateLocales', () => {
    it('should generate alternate locales correctly', () => {
      const result = (meta as any).genAlternateLocales('en', '/test');

      expect(result).toHaveProperty('x-default', expect.stringContaining('/test'));
      expect(result).toHaveProperty('zh-CN', expect.stringContaining('hl=zh-CN'));
      expect(result).not.toHaveProperty('en');
    });
  });

  describe('genTwitter', () => {
    it('should generate Twitter metadata correctly', () => {
      const result = (meta as any).genTwitter({
        title: 'Twitter Title',
        description: 'Twitter description',
        image: 'https://twitter-image.com',
        url: 'https://example.com/twitter',
      });

      expect(result).toEqual({
        card: 'summary_large_image',
        title: 'Twitter Title',
        description: 'Twitter description',
        images: ['https://twitter-image.com'],
        site: '@lobehub',
        url: 'https://example.com/twitter',
      });
    });
  });

  describe('genOpenGraph', () => {
    it('should generate OpenGraph metadata correctly', () => {
      const result = (meta as any).genOpenGraph({
        title: 'OG Title',
        description: 'OG description',
        image: 'https://og-image.com',
        url: 'https://example.com/og',
        locale: 'es-ES',
        type: 'article',
        alternate: true,
      });

      expect(result).toMatchObject({
        title: 'OG Title',
        description: 'OG description',
        images: [{ url: 'https://og-image.com', alt: 'OG Title' }],
        locale: 'es-ES',
        type: 'article',
        url: 'https://example.com/og',
        siteName: BRANDING_NAME,
        alternateLocale: expect.arrayContaining([
          'ar',
          'bg-BG',
          'de-DE',
          'en-US',
          'es-ES',
          'fr-FR',
          'ja-JP',
          'ko-KR',
          'pt-BR',
          'ru-RU',
          'tr-TR',
          'zh-CN',
          'zh-TW',
          'vi-VN',
        ]),
      });
    });
  });
});

describe('Metadata default description and branding', () => {
  const loadMeta = async (branding?: Partial<typeof BusinessConst>) => {
    vi.resetModules();
    if (branding) {
      vi.doMock('@lobechat/business-const', async (importOriginal) => ({
        ...(await importOriginal<typeof BusinessConst>()),
        ...branding,
      }));
      // Under vitest 5 a `doMock` only lands once the test file itself imports
      // something, so pull the mocked module in before the one under test.
      await import('@lobechat/business-const');
    }
    const { Meta: FreshMeta } = await import('./metadata');
    return new FreshMeta();
  };

  afterEach(() => {
    vi.doUnmock('@lobechat/business-const');
    vi.resetModules();
  });

  it('keeps the existing wording under default branding', async () => {
    const result = (await loadMeta()).generate({ title: 'Home', url: 'https://example.com' });

    expect(result.description).toContain(
      'LobeChat offers you the best ChatGPT, OLLaMA, Gemini, Claude WebUI user experience',
    );
  });

  it("names the deployment's own app under custom branding", async () => {
    const result = (await loadMeta({ BRANDING_NAME: 'Acme', ORG_NAME: 'Acme Inc' })).generate({
      title: 'Home',
      url: 'https://example.com',
    });

    expect(result.description).toContain('Acme offers you the best');
    expect(result.description).not.toMatch(/LobeChat|LobeHub/);
  });
});
