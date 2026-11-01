// @vitest-environment node
import { BRANDING_LOGO_URL } from '@lobechat/business-const';
import qs from 'query-string';
import { describe, expect, it, vi } from 'vitest';

import { Manifest, manifestModule } from './manifest';

// Mock external dependencies
vi.mock('@/const/branding', () => ({
  BRANDING_LOGO_URL: 'https://example.com/logo.png',
}));

vi.mock('@/server/utils/url', () => ({
  getCanonicalUrl: vi.fn().mockReturnValue('https://example.com/manifest.webmanifest'),
}));

describe('Manifest', () => {
  const manifest = new Manifest();

  describe('generate', () => {
    it('should generate a valid manifest object', () => {
      const input = {
        color: '#FF0000',
        description: 'Test description',
        name: 'Test App',
        id: 'test-app',
        icons: [{ purpose: 'any' as const, sizes: '192x192', url: 'icon.png' }],
        screenshots: [{ form_factor: 'wide' as const, url: 'screenshot.png' }],
      };

      const result = manifest.generate(input);

      expect(result).toMatchObject({
        background_color: input.color,
        description: input.description,
        name: input.name,
        id: input.id,
        icons: expect.arrayContaining([
          expect.objectContaining({
            purpose: 'any',
            sizes: '192x192',
          }),
        ]),
        screenshots: expect.arrayContaining([
          expect.objectContaining({
            form_factor: 'wide',
            sizes: '1280x676',
          }),
        ]),
      });
    });

    it('should use default color if not provided', () => {
      const input = {
        description: 'Test description',
        name: 'Test App',
        id: 'test-app',
        icons: [],
        screenshots: [],
      };

      const result = manifest.generate(input);

      expect(result.background_color).toBe('#000000');
      expect(result.theme_color).toBe('#000000');
    });
  });

  describe('_getImage', () => {
    it('should return correct image object', () => {
      const url = 'https://example.com/image.png';
      const version = 2;

      // @ts-ignore - Accessing private method for testing
      const result = manifest._getImage(url, version);

      expect(result).toEqual({
        cache_busting_mode: 'query',
        immutable: 'true',
        max_age: 31536000,
        src: qs.stringifyUrl({ query: { v: version }, url: BRANDING_LOGO_URL || url }),
      });
    });

    it('should use default version if not provided', () => {
      const url = 'https://example.com/image.png';

      // @ts-ignore - Accessing private method for testing
      const result = manifest._getImage(url);

      expect(result.src).toContain('v=1');
    });
  });

  describe('_getIcon', () => {
    it('should return correct icon object', () => {
      const icon = {
        url: 'https://example.com/icon.png',
        version: 3,
        sizes: '64x64',
        purpose: 'maskable' as const,
      };

      // @ts-ignore - Accessing private method for testing
      const result = manifest._getIcon(icon);

      expect(result).toMatchObject({
        purpose: 'maskable',
        sizes: '64x64',
        type: 'image/png',
      });
      expect(result.src).toContain('v=3');
    });
  });

  describe('_getScreenshot', () => {
    it('should return correct screenshot object for wide form factor', () => {
      const screenshot = {
        form_factor: 'wide' as const,
        url: 'https://example.com/screenshot.png',
        version: 4,
      };

      // @ts-ignore - Accessing private method for testing
      const result = manifest._getScreenshot(screenshot);

      expect(result).toMatchObject({
        form_factor: 'wide',
        sizes: '1280x676',
        type: 'image/png',
      });
      expect(result.src).toContain('v=4');
    });

    it('should return correct screenshot object for narrow form factor', () => {
      const screenshot = {
        form_factor: 'narrow' as const,
        url: 'https://example.com/screenshot.png',
        sizes: '320x569',
      };

      // @ts-ignore - Accessing private method for testing
      const result = manifest._getScreenshot(screenshot);

      expect(result).toMatchObject({
        cache_busting_mode: 'query',
        form_factor: 'narrow',
        immutable: 'true',
        max_age: 31536000,
        sizes: '1280x676',
        src: 'https://example.com/screenshot.png?v=1',
        type: 'image/png',
      });
    });
  });
});

describe('manifestModule', () => {
  it('should be an instance of Manifest', () => {
    expect(manifestModule).toBeInstanceOf(Manifest);
  });
});
