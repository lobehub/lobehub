import { describe, expect, it } from 'vitest';

import { InvalidUrlError } from '../errorType';
import {
  getNonDocumentExtension,
  isNonDocumentContentType,
  normalizeCrawlUrl,
} from '../urlPreflight';

describe('normalizeCrawlUrl', () => {
  it('should return a valid absolute url untouched', () => {
    expect(normalizeCrawlUrl('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(normalizeCrawlUrl('http://localhost:3000/path')).toBe('http://localhost:3000/path');
  });

  it('should prepend https:// to a bare domain / path', () => {
    expect(normalizeCrawlUrl('example.com')).toBe('https://example.com');
    expect(normalizeCrawlUrl('www.example.com/docs/intro')).toBe(
      'https://www.example.com/docs/intro',
    );
    expect(normalizeCrawlUrl('lobe.zhouyu.li:8443/app')).toBe('https://lobe.zhouyu.li:8443/app');
    expect(normalizeCrawlUrl('//cdn.example.com/x')).toBe('https://cdn.example.com/x');
  });

  it('should unwrap markdown links, angle brackets, quotes and trailing punctuation', () => {
    expect(normalizeCrawlUrl('[LobeHub](https://lobehub.com/docs)')).toBe(
      'https://lobehub.com/docs',
    );
    expect(normalizeCrawlUrl('[LobeHub](https://lobehub.com/docs "title")')).toBe(
      'https://lobehub.com/docs',
    );
    expect(normalizeCrawlUrl('<https://example.com/a>')).toBe('https://example.com/a');
    expect(normalizeCrawlUrl('"https://example.com/a"')).toBe('https://example.com/a');
    expect(normalizeCrawlUrl('  https://example.com/a.  ')).toBe('https://example.com/a');
    expect(normalizeCrawlUrl('https://example.com/a),')).toBe('https://example.com/a');
    expect(normalizeCrawlUrl('[docs](example.com/docs)')).toBe('https://example.com/docs');
  });

  it('should keep balanced parentheses that are part of the url', () => {
    expect(normalizeCrawlUrl('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    );
  });

  it('should throw InvalidUrlError for text that is not a url', () => {
    for (const input of [
      '',
      '   ',
      'not a url at all',
      'search for lobehub pricing',
      'ftp://example.com/file',
      'mailto:someone@example.com',
      'javascript:alert(1)',
    ]) {
      expect(() => normalizeCrawlUrl(input)).toThrow(InvalidUrlError);
    }
  });

  it('should handle long runs of wrapping characters without backtracking', () => {
    // these shapes made the previous anchored `[…]+$` regexes backtrack quadratically
    expect(normalizeCrawlUrl(`https://example.com/a${'"'.repeat(50_000)}`)).toBe(
      'https://example.com/a',
    );
    expect(normalizeCrawlUrl(`https://example.com/a${'\t'.repeat(50_000)}`)).toBe(
      'https://example.com/a',
    );
    expect(normalizeCrawlUrl(`https://example.com/a${')'.repeat(50_000)}`)).toBe(
      'https://example.com/a',
    );
    expect(() => normalizeCrawlUrl('"'.repeat(50_000))).toThrow(InvalidUrlError);
  });

  it('should truncate very long inputs in the error message', () => {
    const long = 'x'.repeat(500);
    expect(() => normalizeCrawlUrl(long)).toThrow(/…/);
  });
});

describe('getNonDocumentExtension', () => {
  it('should detect images, fonts, media and archives by extension', () => {
    expect(getNonDocumentExtension('https://a.com/app-icons/icon-512x512.png')).toBe('png');
    expect(getNonDocumentExtension('https://a.com/logo.SVG?v=1')).toBe('svg');
    expect(getNonDocumentExtension('https://a.com/fonts/inter.woff2')).toBe('woff2');
    expect(getNonDocumentExtension('https://a.com/shot-1.mobile.png')).toBe('png');
    expect(getNonDocumentExtension('https://a.com/video.mp4#t=10')).toBe('mp4');
    expect(getNonDocumentExtension('https://a.com/release.zip')).toBe('zip');
  });

  it('should allow document-like urls', () => {
    expect(getNonDocumentExtension('https://a.com/')).toBeUndefined();
    expect(getNonDocumentExtension('https://a.com/docs/intro')).toBeUndefined();
    expect(getNonDocumentExtension('https://a.com/page.html')).toBeUndefined();
    expect(getNonDocumentExtension('https://a.com/paper.pdf')).toBeUndefined();
    expect(getNonDocumentExtension('https://a.com/data.json')).toBeUndefined();
    expect(getNonDocumentExtension('https://a.com/v2.0.1')).toBeUndefined();
    expect(getNonDocumentExtension('https://a.com/.env')).toBeUndefined();
    expect(getNonDocumentExtension('not a url')).toBeUndefined();
  });
});

describe('isNonDocumentContentType', () => {
  it('should flag binary media types', () => {
    expect(isNonDocumentContentType('image/png')).toBe(true);
    expect(isNonDocumentContentType('image/svg+xml; charset=utf-8')).toBe(true);
    expect(isNonDocumentContentType('font/woff2')).toBe(true);
    expect(isNonDocumentContentType('video/mp4')).toBe(true);
    expect(isNonDocumentContentType('application/octet-stream')).toBe(true);
    expect(isNonDocumentContentType('APPLICATION/ZIP')).toBe(true);
  });

  it('should allow textual types', () => {
    expect(isNonDocumentContentType('text/html; charset=utf-8')).toBe(false);
    expect(isNonDocumentContentType('application/json')).toBe(false);
    expect(isNonDocumentContentType('application/pdf')).toBe(false);
    expect(isNonDocumentContentType('text/plain')).toBe(false);
    expect(isNonDocumentContentType(undefined)).toBe(false);
    expect(isNonDocumentContentType(null)).toBe(false);
  });
});
