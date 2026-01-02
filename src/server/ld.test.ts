// @vitest-environment node
import { BRANDING_NAME } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { DEFAULT_LANG } from '@/const/locale';

import { AUTHOR_LIST, Ld } from './ld';

describe('Ld', () => {
  const ld = new Ld();

  describe('generate', () => {
    it('should generate correct LD+JSON structure', () => {
      const result = ld.generate({
        title: 'Test Title',
        description: 'Test Description',
        url: 'https://example.com/test',
        locale: DEFAULT_LANG,
      });

      expect(result['@context']).toBe('https://schema.org');
      expect(Array.isArray(result['@graph'])).toBe(true);
      expect(result['@graph'].length).toBeGreaterThan(0);
    });
  });

  describe('genOrganization', () => {
    it('should generate correct organization structure', () => {
      const org = ld.genOrganization();

      expect(org['@type']).toBe('Organization');
      expect(org.name).toBe('LobeHub');
      expect(org.url).toBe('https://lobehub.com');
    });
  });

  describe('getAuthors', () => {
    it('should return default author when no ids provided', () => {
      const author = ld.getAuthors();
      expect(author['@type']).toBe('Organization');
    });

    it('should return person when valid id provided', () => {
      const author = ld.getAuthors(['arvinxx']);
      expect(author['@type']).toBe('Person');
      // @ts-ignore
      expect(author.name).toBe(AUTHOR_LIST.arvinxx.name);
    });
  });

  describe('genWebPage', () => {
    it('should generate correct webpage structure', () => {
      const webpage = ld.genWebPage({
        title: 'Test Page',
        description: 'Test Description',
        url: 'https://example.com/test',
        locale: DEFAULT_LANG,
      });

      expect(webpage['@type']).toBe('WebPage');
      expect(webpage.name).toBe(`Test Page · ${BRANDING_NAME}`);
      expect(webpage.description).toBe('Test Description');
    });
  });

  describe('genImageObject', () => {
    it('should generate correct image object', () => {
      const image = ld.genImageObject({
        image: 'https://example.com/image.jpg',
        url: 'https://example.com/test',
      });

      expect(image['@type']).toBe('ImageObject');
      expect(image.url).toBe('https://example.com/image.jpg');
    });
  });

  describe('genWebSite', () => {
    it('should generate correct website structure', () => {
      const website = ld.genWebSite();

      expect(website['@type']).toBe('WebSite');
      expect(website.name).toBe(BRANDING_NAME);
    });
  });

  describe('genArticle', () => {
    it('should generate correct article structure', () => {
      const article = ld.genArticle({
        title: 'Test Article',
        description: 'Test Description',
        url: 'https://example.com/test',
        author: ['arvinxx'],
        identifier: 'test-id',
        locale: DEFAULT_LANG,
      });

      expect(article['@type']).toBe('Article');
      expect(article.headline).toBe(`Test Article · ${BRANDING_NAME}`);
      expect(article.author['@type']).toBe('Person');
    });
  });
});
