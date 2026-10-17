import { describe, expect, it } from 'vitest';

import { getFileLinkOpenAction, parseFileLinkHref } from './parse';

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

  it('returns null instead of throwing on a malformed percent-encoded file id', () => {
    expect(parseFileLinkHref('/f/%', ORIGIN)).toBeNull();
  });

  it('does not match a cross-origin link sharing the same path shape', () => {
    expect(parseFileLinkHref('https://example.com/f/not-ours', ORIGIN)).toBeNull();
  });

  it('treats the official cloud hosts as one app', () => {
    // Desktop cloud mode classifies against the gateway apex, while links
    // written earlier still point at app.lobehub.com.
    expect(
      parseFileLinkHref('https://app.lobehub.com/f/file_abc123', 'https://lobehub.com'),
    ).toEqual({ fileId: 'file_abc123' });
    expect(
      parseFileLinkHref('https://lobehub.com/f/file_abc123', 'https://app.lobehub.com'),
    ).toEqual({ fileId: 'file_abc123' });
  });

  it('does not treat other official subdomains as the app', () => {
    expect(
      parseFileLinkHref('https://staging.app.lobehub.com/f/file_abc123', 'https://lobehub.com'),
    ).toBeNull();
    expect(
      parseFileLinkHref(
        'https://device-gateway.lobehub.com/f/file_abc123',
        'https://app.lobehub.com',
      ),
    ).toBeNull();
  });

  it('does not treat a look-alike host as the official cloud', () => {
    expect(
      parseFileLinkHref('https://lobehub.com.evil.example/f/file_abc123', 'https://lobehub.com'),
    ).toBeNull();
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

describe('getFileLinkOpenAction', () => {
  const link = { fileId: 'file_1', label: 'report.md', linkHref: `${ORIGIN}/f/file_1` };

  it('opens the owner-scoped preview by id for the file owner', () => {
    expect(getFileLinkOpenAction({ ...link, isAgentShareVisitor: false })).toEqual({
      kind: 'preview',
      params: { fileId: 'file_1' },
    });
  });

  // Regression: the visitor does not own the creator's file, so the
  // id-only preview fetched nothing and showed "file unavailable".
  it('previews from the public /f/:id link on the agent-share visitor page', () => {
    expect(getFileLinkOpenAction({ ...link, isAgentShareVisitor: true })).toEqual({
      kind: 'preview',
      params: { fileId: 'file_1', source: { name: 'report.md', url: `${ORIGIN}/f/file_1` } },
    });
  });

  it('opens the public link in a new tab when the visitor label names no file type', () => {
    expect(
      getFileLinkOpenAction({ ...link, isAgentShareVisitor: true, label: 'Download the deck' }),
    ).toEqual({ kind: 'newTab', url: `${ORIGIN}/f/file_1` });
  });
});
