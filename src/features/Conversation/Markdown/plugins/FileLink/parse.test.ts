import { describe, expect, it } from 'vitest';

import { parseFileLinkHref } from './parse';

const ORIGIN = 'https://app.lobehub.com';

describe('parseFileLinkHref', () => {
  it('matches a same-origin absolute file proxy link', () => {
    expect(parseFileLinkHref(`${ORIGIN}/f/file_abc123`, ORIGIN)).toEqual({
      fileId: 'file_abc123',
    });
  });

  it('matches a root-relative file proxy link regardless of currentOrigin', () => {
    expect(parseFileLinkHref('/f/file_xyz')).toEqual({ fileId: 'file_xyz' });
    expect(parseFileLinkHref('/f/file_xyz', ORIGIN)).toEqual({ fileId: 'file_xyz' });
  });

  it('decodes an encoded file id', () => {
    expect(parseFileLinkHref('/f/file%20with%20space', ORIGIN)).toEqual({
      fileId: 'file with space',
    });
  });

  it('does not match a cross-origin link sharing the same path shape', () => {
    expect(parseFileLinkHref('https://example.com/f/not-ours', ORIGIN)).toBeNull();
  });

  it('does not match an absolute link when no currentOrigin is known', () => {
    expect(parseFileLinkHref(`${ORIGIN}/f/file_abc123`)).toBeNull();
  });

  it('does not match a normal external link', () => {
    expect(parseFileLinkHref('https://example.com/docs', ORIGIN)).toBeNull();
  });

  it('does not match other app routes', () => {
    expect(parseFileLinkHref('/api/agent/stream', ORIGIN)).toBeNull();
    expect(parseFileLinkHref('/features/foo', ORIGIN)).toBeNull();
  });

  it('returns null for an empty href', () => {
    expect(parseFileLinkHref(undefined, ORIGIN)).toBeNull();
    expect(parseFileLinkHref('', ORIGIN)).toBeNull();
  });
});
