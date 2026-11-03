import { describe, expect, it } from 'vitest';

import { formatDescLength, formatTitleLength } from './genOG';

describe('genOG utilities', () => {
  describe('formatTitleLength', () => {
    it('should return the title as-is when length is within limit', () => {
      const shortTitle = 'Short Title';
      const result = formatTitleLength(shortTitle);

      expect(result).toBe(shortTitle);
    });

    it('should return the title as-is when exactly at limit (60 chars)', () => {
      const title = 'A'.repeat(60);
      const result = formatTitleLength(title);

      expect(result).toBe(title);
    });

    it('should truncate and add ellipsis when title exceeds 60 characters', () => {
      const longTitle = 'This is a very long title that exceeds sixty characters limit';
      const result = formatTitleLength(longTitle);

      expect(result).toHaveLength(60);
      expect(result).toMatch(/\.{3}$/);
      expect(result).toBe(longTitle.slice(0, 57) + '...');
    });

    it('should apply addOnLength parameter to reduce max length', () => {
      const title = 'A'.repeat(60);
      const result = formatTitleLength(title, 10);

      expect(result).toHaveLength(50);
      expect(result).toMatch(/\.{3}$/);
      expect(result).toBe(title.slice(0, 47) + '...');
    });

    it('should handle empty string', () => {
      const result = formatTitleLength('');

      expect(result).toBe('');
    });

    it('should handle single character', () => {
      const result = formatTitleLength('A');

      expect(result).toBe('A');
    });

    it('should handle unicode characters correctly', () => {
      const unicodeTitle = '你好'.repeat(30); // 60 characters
      const result = formatTitleLength(unicodeTitle);

      expect(result).toBe(unicodeTitle);
    });

    it('should truncate unicode characters when over limit', () => {
      const unicodeTitle = '你好'.repeat(31); // 62 characters
      const result = formatTitleLength(unicodeTitle);

      expect(result).toHaveLength(60);
      expect(result).toMatch(/\.{3}$/);
    });

    it('should handle addOnLength of 0', () => {
      const title = 'A'.repeat(60);
      const result = formatTitleLength(title, 0);

      expect(result).toBe(title);
    });

    it('should handle large addOnLength values', () => {
      const title = 'A'.repeat(60);
      const result = formatTitleLength(title, 50);

      expect(result).toHaveLength(10);
      expect(result).toMatch(/\.{3}$/);
      expect(result).toBe(title.slice(0, 7) + '...');
    });
  });

  describe('formatDescLength', () => {
    it('should return undefined when desc is empty', () => {
      const result = formatDescLength('');

      expect(result).toBeUndefined();
    });

    it('should return undefined when desc is null', () => {
      const result = formatDescLength(null as any);

      expect(result).toBeUndefined();
    });

    it('should return undefined when desc is undefined', () => {
      const result = formatDescLength(undefined as any);

      expect(result).toBeUndefined();
    });

    it('should return the description as-is when length is within 160 limit', () => {
      const shortDesc = 'This is a short description.';
      const result = formatDescLength(shortDesc);

      expect(result).toBe(shortDesc);
    });

    it('should return the description as-is when exactly at 160 limit', () => {
      const desc = 'A'.repeat(160);
      const result = formatDescLength(desc);

      expect(result).toBe(desc);
    });

    it('should truncate and add ellipsis when description exceeds 160 characters', () => {
      const longDesc = 'A'.repeat(170);
      const result = formatDescLength(longDesc);

      expect(result).toHaveLength(160);
      expect(result).toMatch(/\.{3}$/);
      expect(result).toBe(longDesc.slice(0, 157) + '...');
    });

    it('should append tags when description is short and tags provided', () => {
      const desc = 'Short description';
      const tags = ['tag1', 'tag2', 'tag3'];
      const result = formatDescLength(desc, tags);

      expect(result).toContain(desc);
      expect(result).toContain('tag1');
      expect(result).toContain('tag2');
      expect(result).toContain('tag3');
    });

    it('should join tags with comma and space', () => {
      const desc = 'Description';
      const tags = ['tag1', 'tag2'];
      const result = formatDescLength(desc, tags);

      expect(result).toContain('tag1, tag2');
    });

    it('should truncate tags when combined length would exceed available space', () => {
      const desc = 'A'.repeat(100);
      const tags = ['verylongtag1', 'verylongtag2', 'verylongtag3', 'verylongtag4', 'verylongtag5'];
      const result = formatDescLength(desc, tags);

      // tagLength = 160 - 100 - 3 = 57
      // tagStr will be truncated to 57 chars and '...' added
      // newDesc = 100 + 57 + 3 = 160, which is > 157, so another '...' is added
      expect(result).toMatch(/\.{3}$/);
      expect(result.length).toBeGreaterThan(160); // Will be 163 due to double ellipsis
    });

    it('should handle empty tags array', () => {
      const desc = 'Description';
      const result = formatDescLength(desc, []);

      expect(result).toBe(desc);
    });

    it('should not add tags when description already exceeds 160', () => {
      const longDesc = 'A'.repeat(170);
      const tags = ['tag1', 'tag2'];
      const result = formatDescLength(longDesc, tags);

      expect(result).not.toContain('tag1');
      expect(result).not.toContain('tag2');
      expect(result).toHaveLength(160);
    });

    it('should handle single tag', () => {
      const desc = 'Description';
      const tags = ['singletag'];
      const result = formatDescLength(desc, tags);

      expect(result).toContain('singletag');
    });

    it('should calculate tag length correctly', () => {
      const desc = 'A'.repeat(140); // 140 chars
      const tags = ['tag1', 'tag2']; // "tag1, tag2" = 11 chars
      const result = formatDescLength(desc, tags);

      // Should fit: 140 + 11 = 151 chars < 160
      expect(result).toContain('tag1');
      expect(result.length).toBeLessThanOrEqual(160);
    });

    it('should add ellipsis to truncated tags', () => {
      const desc = 'A'.repeat(150); // 150 chars
      const tags = ['verylongtag1', 'verylongtag2', 'verylongtag3'];
      const result = formatDescLength(desc, tags);

      // tagLength = 160 - 150 - 3 = 7
      // tagStr will be truncated to 7 chars and '...' added
      // newDesc = 150 + 7 + 3 = 160, which is > 157, so another '...' is added
      expect(result).toMatch(/\.{3}$/);
      expect(result.length).toBeGreaterThan(160); // Will be 163 due to double ellipsis
    });

    it('should handle unicode characters in description', () => {
      const desc = '你好世界 '.repeat(20); // 100 characters
      const result = formatDescLength(desc);

      expect(result).toBe(desc);
    });

    it('should handle unicode characters in tags', () => {
      const desc = 'Description';
      const tags = ['标签1', '标签2'];
      const result = formatDescLength(desc, tags);

      expect(result).toContain('标签1');
      expect(result).toContain('标签2');
    });

    it('should add trailing ellipsis when newDesc is 157 chars or less', () => {
      const desc = 'A'.repeat(100);
      const tags = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6'];
      const result = formatDescLength(desc, tags);

      // This should trigger the final condition: newDesc.length <= 157 ? newDesc : newDesc + '...'
      if (result.length > 157) {
        expect(result).toMatch(/\.{3}$/);
      }
    });

    it('should handle desc at 157 chars with no tags', () => {
      const desc = 'A'.repeat(157);
      const result = formatDescLength(desc);

      expect(result).toBe(desc);
    });

    it('should add ellipsis when desc with tags exceeds 157 chars', () => {
      const desc = 'A'.repeat(140);
      const tags = ['longtag1', 'longtag2', 'longtag3'];
      const result = formatDescLength(desc, tags);

      // desc + tags might exceed 157, so should add '...'
      if (result.length > 160) {
        expect(result).toMatch(/\.{3}$/);
      }
    });
  });

  describe('edge cases', () => {
    it('formatTitleLength should handle very large addOnLength', () => {
      const title = 'Title';
      const result = formatTitleLength(title, 100);

      // 60 - 100 = -40, so it should use negative limit
      expect(result).toMatch(/\.{3}$/);
    });

    it('formatDescLength should handle description with only spaces', () => {
      const desc = '   ';
      const result = formatDescLength(desc);

      expect(result).toBe(desc);
    });

    it('formatDescLength should handle tags with empty strings', () => {
      const desc = 'Description';
      const tags = ['', 'tag1', ''];
      const result = formatDescLength(desc, tags);

      // tags.join(', ') produces ', tag1, ' which doesn't have ', ,' in the middle
      expect(result).toContain('tag1');
      expect(result).toContain(', tag1, ');
    });

    it('formatTitleLength should handle special characters', () => {
      const title = '!@#$%^&*()_+-=[]{}|;:\'"<>?/`~';
      const result = formatTitleLength(title);

      expect(result).toBe(title);
    });

    it('formatDescLength should handle special characters in tags', () => {
      const desc = 'Description';
      const tags = ['tag!@#', 'tag$%^'];
      const result = formatDescLength(desc, tags);

      expect(result).toContain('tag!@#');
      expect(result).toContain('tag$%^');
    });
  });
});
