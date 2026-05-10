import { describe, expect, it } from 'vitest';

import { crawUrlRules } from '../urlRules';

describe('urlRules', () => {
  it('should export an array of CrawlUrlRule objects', () => {
    expect(Array.isArray(crawUrlRules)).toBe(true);
    expect(crawUrlRules.length).toBeGreaterThan(0);
  });

  it('should have valid rule structure for each rule', () => {
    crawUrlRules.forEach((rule, index) => {
      expect(rule).toHaveProperty('urlPattern');
      expect(typeof rule.urlPattern).toBe('string');
      expect(rule.urlPattern.length).toBeGreaterThan(0);

      if (rule.impls) {
        expect(Array.isArray(rule.impls)).toBe(true);
        expect(rule.impls.length).toBeGreaterThan(0);
      }

      if (rule.filterOptions) {
        expect(typeof rule.filterOptions).toBe('object');
      }

      if (rule.urlTransform) {
        expect(typeof rule.urlTransform).toBe('string');
        expect(rule.urlTransform.length).toBeGreaterThan(0);
      }
    });
  });

  describe('specific URL patterns', () => {
    it('should match Sogou links', () => {
      const sogouRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://sogou.com/link(.*)',
      );

      expect(sogouRule).toBeDefined();
      expect(sogouRule?.impls).toEqual(['search1api']);
    });

    it('should match YouTube links', () => {
      const youtubeRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://www.youtube.com/watch(.*)',
      );

      expect(youtubeRule).toBeDefined();
      expect(youtubeRule?.impls).toEqual(['search1api']);
    });

    it('should match Reddit links', () => {
      const redditRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://www.reddit.com/r/(.*)/comments/(.*)',
      );

      expect(redditRule).toBeDefined();
      expect(redditRule?.impls).toEqual(['search1api']);
    });

    it('should match GitHub blob links with URL transformation', () => {
      const githubBlobRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://github.com/([^/]+)/([^/]+)/blob/([^/]+)/(.*)',
      );

      expect(githubBlobRule).toBeDefined();
      expect(githubBlobRule?.impls).toEqual(['naive', 'jina']);
      expect(githubBlobRule?.urlTransform).toBe('https://github.com/$1/$2/raw/refs/heads/$3/$4');
      expect(githubBlobRule?.filterOptions?.enableReadability).toBe(false);
    });

    it('should match GitHub discussion links', () => {
      const githubDiscussionRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://github.com/(.*)/discussions/(.*)',
      );

      expect(githubDiscussionRule).toBeDefined();
      expect(githubDiscussionRule?.impls).toEqual(['naive', 'jina']);
      expect(githubDiscussionRule?.filterOptions?.enableReadability).toBe(false);
    });

    it('should match PDF files', () => {
      const pdfRule = crawUrlRules.find((rule) => rule.urlPattern === 'https://(.*).pdf');

      expect(pdfRule).toBeDefined();
      expect(pdfRule?.impls).toEqual(['jina']);
    });

    it('should match arXiv PDF links', () => {
      const arxivRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://arxiv.org/pdf/(.*)',
      );

      expect(arxivRule).toBeDefined();
      expect(arxivRule?.impls).toEqual(['jina']);
    });

    it('should match Medium links with URL transformation', () => {
      const mediumRule = crawUrlRules.find((rule) => rule.urlPattern === 'https://medium.com/(.*)');

      expect(mediumRule).toBeDefined();
      expect(mediumRule?.urlTransform).toBe('https://scribe.rip/$1');
    });

    it('should match Twitter/X links', () => {
      const twitterRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://(twitter.com|x.com)/(.*)',
      );

      expect(twitterRule).toBeDefined();
      expect(twitterRule?.impls).toEqual(['jina', 'browserless']);
      expect(twitterRule?.filterOptions?.enableReadability).toBe(false);
    });

    it('should match sports data website with specific filter options', () => {
      const sportsRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://www.qiumiwu.com/standings/(.*)',
      );

      expect(sportsRule).toBeDefined();
      expect(sportsRule?.impls).toEqual(['naive']);
      expect(sportsRule?.filterOptions?.enableReadability).toBe(false);
      expect(sportsRule?.filterOptions?.pureText).toBe(true);
    });

    it('should match Mozilla Developer docs', () => {
      const mozillaRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://developer.mozilla.org(.*)',
      );

      expect(mozillaRule).toBeDefined();
      expect(mozillaRule?.impls).toEqual(['jina']);
    });

    it('should match CVPR links', () => {
      const cvprRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://cvpr.thecvf.com(.*)',
      );

      expect(cvprRule).toBeDefined();
      expect(cvprRule?.impls).toEqual(['jina']);
    });

    it('should match Feishu links', () => {
      const feishuRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://(.*).feishu.cn/(.*)',
      );

      expect(feishuRule).toBeDefined();
      expect(feishuRule?.impls).toEqual(['jina']);
    });

    it('should match Xiaohongshu (Little Red Book) links', () => {
      const xiaohongshuRule = crawUrlRules.find(
        (rule) => rule.urlPattern === 'https://(.*).xiaohongshu.com/(.*)',
      );

      expect(xiaohongshuRule).toBeDefined();
      expect(xiaohongshuRule?.impls).toEqual(['search1api', 'jina']);
    });
  });

  describe('URL pattern validation', () => {
    it('should have valid regex patterns that can be compiled', () => {
      crawUrlRules.forEach((rule, index) => {
        expect(() => {
          new RegExp(rule.urlPattern);
        }).not.toThrow(`Rule at index ${index} should have valid regex pattern`);
      });
    });
  });

  describe('impl validation', () => {
    const validImpls = ['naive', 'jina', 'browserless', 'search1api', 'exa', 'firecrawl', 'tavily'];

    it('should only use valid crawler implementations', () => {
      crawUrlRules.forEach((rule, index) => {
        if (rule.impls) {
          rule.impls.forEach((impl) => {
            expect(validImpls).toContain(impl);
          });
        }
      });
    });
  });

  describe('filter options validation', () => {
    it('should have valid filter options structure', () => {
      crawUrlRules.forEach((rule, index) => {
        if (rule.filterOptions) {
          const { filterOptions } = rule;

          if ('enableReadability' in filterOptions) {
            expect(typeof filterOptions.enableReadability).toBe('boolean');
          }

          if ('pureText' in filterOptions) {
            expect(typeof filterOptions.pureText).toBe('boolean');
          }
        }
      });
    });
  });

  describe('URL transformation validation', () => {
    it('should have valid URL transformation templates', () => {
      crawUrlRules.forEach((rule, index) => {
        if (rule.urlTransform) {
          // Check if URL transform contains placeholder groups
          expect(rule.urlTransform).toMatch(/\$\d+/);

          // Check if it's a valid URL format
          expect(rule.urlTransform).toMatch(/^https?:\/\//);
        }
      });
    });
  });

  describe('rule completeness', () => {
    it('should cover major social media platforms', () => {
      const patterns = crawUrlRules.map((rule) => rule.urlPattern);

      // Check for major platforms
      expect(patterns.some((p) => p.includes('youtube.com'))).toBe(true);
      expect(patterns.some((p) => p.includes('reddit.com'))).toBe(true);
      expect(patterns.some((p) => p.includes('twitter.com') || p.includes('x.com'))).toBe(true);
      expect(patterns.some((p) => p.includes('medium.com'))).toBe(true);
      expect(patterns.some((p) => p.includes('github.com'))).toBe(true);
    });

    it('should cover Chinese platforms', () => {
      const patterns = crawUrlRules.map((rule) => rule.urlPattern);

      // Check for Chinese platforms
      expect(patterns.some((p) => p.includes('xiaohongshu.com'))).toBe(true);
      expect(patterns.some((p) => p.includes('feishu.cn'))).toBe(true);
    });
  });
});
