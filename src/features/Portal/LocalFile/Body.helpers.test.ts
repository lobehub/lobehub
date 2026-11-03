import { describe, expect, it } from 'vitest';

import {
  getFileExtension,
  resolveMarkdownRelativeAssetPath,
} from '@/features/Portal/LocalFile/Body.helpers';

describe('LocalFile Body helpers', () => {
  describe('getFileExtension', () => {
    it('returns the final extension and ignores dotfiles', () => {
      expect(getFileExtension('report.md')).toBe('md');
      expect(getFileExtension('/repo/.gitignore')).toBe('');
      expect(getFileExtension('/repo/archive.tar.gz')).toBe('gz');
    });
  });

  describe('resolveMarkdownRelativeAssetPath', () => {
    it('resolves relative markdown image paths against the markdown file directory', () => {
      expect(
        resolveMarkdownRelativeAssetPath({
          markdownFilePath: '/repo/.records/report.md',
          src: 'assets/screenshot.png',
        }),
      ).toBe('/repo/.records/assets/screenshot.png');
    });

    it('handles dot segments and encoded path segments', () => {
      expect(
        resolveMarkdownRelativeAssetPath({
          markdownFilePath: '/repo/docs/reports/report.md',
          src: './assets/My%20Image.png?raw=1#preview',
        }),
      ).toBe('/repo/docs/reports/assets/My Image.png');

      expect(
        resolveMarkdownRelativeAssetPath({
          markdownFilePath: '/repo/docs/reports/report.md',
          src: '../shared/diagram.png',
        }),
      ).toBe('/repo/docs/shared/diagram.png');
    });

    it('keeps Windows-style paths on Windows-style inputs', () => {
      expect(
        resolveMarkdownRelativeAssetPath({
          markdownFilePath: 'C:\\repo\\docs\\report.md',
          src: 'assets\\screen.png',
        }),
      ).toBe('C:\\repo\\docs\\assets\\screen.png');
    });

    it('preserves UNC network share prefixes', () => {
      expect(
        resolveMarkdownRelativeAssetPath({
          markdownFilePath: '\\\\server\\share\\docs\\README.md',
          src: 'assets\\screen.png',
        }),
      ).toBe('\\\\server\\share\\docs\\assets\\screen.png');
    });

    it('ignores URLs, root-relative paths, anchors, and empty values', () => {
      const markdownFilePath = '/repo/report.md';

      expect(
        resolveMarkdownRelativeAssetPath({ markdownFilePath, src: 'https://example.com/a.png' }),
      ).toBeUndefined();
      expect(
        resolveMarkdownRelativeAssetPath({ markdownFilePath, src: 'data:image/png;base64,abc' }),
      ).toBeUndefined();
      expect(
        resolveMarkdownRelativeAssetPath({ markdownFilePath, src: '//example.com/a.png' }),
      ).toBeUndefined();
      expect(
        resolveMarkdownRelativeAssetPath({ markdownFilePath, src: '/assets/a.png' }),
      ).toBeUndefined();
      expect(resolveMarkdownRelativeAssetPath({ markdownFilePath, src: '#hash' })).toBeUndefined();
      expect(resolveMarkdownRelativeAssetPath({ markdownFilePath, src: '' })).toBeUndefined();
    });
  });
});
