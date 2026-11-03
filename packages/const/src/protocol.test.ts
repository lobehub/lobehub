import { describe, expect, it } from 'vitest';

import { buildLocalFileUrl } from './protocol';

describe('buildLocalFileUrl', () => {
  it('returns null for empty / nullish input', () => {
    expect(buildLocalFileUrl(null)).toBeNull();
    expect(buildLocalFileUrl(undefined)).toBeNull();
    expect(buildLocalFileUrl('')).toBeNull();
  });

  it('rejects relative paths', () => {
    expect(buildLocalFileUrl('relative/path.png')).toBeNull();
    expect(buildLocalFileUrl('./img.png')).toBeNull();
  });

  it('builds a URL from a POSIX absolute path', () => {
    expect(buildLocalFileUrl('/Users/alice/Pictures/cat.png')).toBe(
      'localfile://file/Users/alice/Pictures/cat.png',
    );
  });

  it('builds a URL from a Windows absolute path', () => {
    expect(buildLocalFileUrl('C:\\Users\\alice\\img.png')).toBe(
      'localfile://file/C%3A/Users/alice/img.png',
    );
  });

  it('percent-encodes special characters per segment', () => {
    expect(buildLocalFileUrl('/Users/alice/My Pictures/图 #.png')).toBe(
      'localfile://file/Users/alice/My%20Pictures/%E5%9B%BE%20%23.png',
    );
  });

  it('survives a URL round-trip back to the original POSIX path', () => {
    const original = '/Users/alice/My Pictures/cat #1.png';
    const url = new URL(buildLocalFileUrl(original)!);
    const decoded = decodeURIComponent(url.pathname);
    expect(decoded).toBe(original);
  });
});
