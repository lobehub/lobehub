import { describe, expect, it } from 'vitest';

import { getFileLinkOpenAction, parseFileLinkHref } from './parse';

const ORIGIN = 'https://app.lobehub.com';

describe('parseFileLinkHref', () => {
  it('matches a same-origin absolute file proxy link', () => {
    expect(parseFileLinkHref(`${ORIGIN}/f/file_abc123`, ORIGIN)).toEqual({
      fileId: 'file_abc123',
      proxyHref: `${ORIGIN}/f/file_abc123`,
    });
  });

  it('matches a root-relative file proxy link regardless of currentOrigin', () => {
    expect(parseFileLinkHref('/f/file_xyz')?.fileId).toBe('file_xyz');
    expect(parseFileLinkHref('/f/file_xyz', ORIGIN)?.fileId).toBe('file_xyz');
  });

  it('decodes an encoded file id', () => {
    expect(parseFileLinkHref('/f/file%20with%20space', ORIGIN)?.fileId).toBe('file with space');
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
      parseFileLinkHref('https://app.lobehub.com/f/file_abc123', 'https://lobehub.com')?.fileId,
    ).toBe('file_abc123');
    expect(
      parseFileLinkHref('https://lobehub.com/f/file_abc123', 'https://app.lobehub.com')?.fileId,
    ).toBe('file_abc123');
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

describe('parseFileLinkHref Docs file links', () => {
  // Regression: `lh file upload` prints `/resource/file/<id>` (and printed
  // `/resource?file=<id>` before), which left the chat for the Docs page
  // instead of previewing beside the conversation.
  it('matches the Docs file path the CLI prints', () => {
    expect(parseFileLinkHref('https://lobehub.com/resource/file/file_ynz', ORIGIN)).toEqual({
      fileId: 'file_ynz',
      proxyHref: 'https://lobehub.com/f/file_ynz',
    });
  });

  it('matches the legacy ?file= Docs link and a library item', () => {
    expect(parseFileLinkHref('https://lobehub.com/resource?file=file_ynz', ORIGIN)?.fileId).toBe(
      'file_ynz',
    );
    expect(parseFileLinkHref('/resource/library/kb_1?file=file_ynz', ORIGIN)).toEqual({
      fileId: 'file_ynz',
      proxyHref: '/f/file_ynz',
    });
  });

  it('leaves a page opened through ?file= to the entity link', () => {
    expect(parseFileLinkHref('/resource?file=docs_abc', ORIGIN)).toBeNull();
    expect(parseFileLinkHref('/resource/page/abc', ORIGIN)).toBeNull();
  });

  // The legacy `?file=docs_x` redirects to `/resource/file/docs_x`, which
  // Docs opens as a page, so that address must not open the file panel.
  it('leaves a page addressed through the file path to Docs', () => {
    expect(parseFileLinkHref('/resource/file/docs_abc', ORIGIN)).toBeNull();
  });

  it('matches an older upload whose id is a bare UUID', () => {
    const id = '14639096-839f-43f3-92c6-ed4f839c0796';
    expect(parseFileLinkHref(`/resource/file/${id}`, ORIGIN)?.fileId).toBe(id);
    expect(parseFileLinkHref(`/resource?file=${id}`, ORIGIN)?.fileId).toBe(id);
  });

  it('matches a link prefixed with the active workspace only', () => {
    const href = `${ORIGIN}/acme/resource/file/file_ynz`;

    expect(parseFileLinkHref(href, ORIGIN, { activeWorkspaceSlug: 'acme' })).toEqual({
      fileId: 'file_ynz',
      proxyHref: `${ORIGIN}/f/file_ynz`,
    });
    expect(parseFileLinkHref(href, ORIGIN, { activeWorkspaceSlug: 'other' })).toBeNull();
    expect(parseFileLinkHref(href, ORIGIN)).toBeNull();
  });

  it('does not match a Docs path on a foreign host', () => {
    expect(parseFileLinkHref('https://example.com/resource/file/file_ynz', ORIGIN)).toBeNull();
  });
});

describe('getFileLinkOpenAction', () => {
  const link = { fileId: 'file_1', label: 'report.md', proxyHref: `${ORIGIN}/f/file_1` };

  it('opens the owner-scoped preview by id for the file owner', () => {
    expect(getFileLinkOpenAction({ ...link, isShareVisitor: false })).toEqual({
      kind: 'preview',
      params: { fileId: 'file_1' },
    });
  });

  // Regression: the visitor does not own the creator's file, so the
  // id-only preview fetched nothing and showed "file unavailable".
  it('previews from the public /f/:id link on the agent-share visitor page', () => {
    expect(getFileLinkOpenAction({ ...link, isShareVisitor: true })).toEqual({
      kind: 'preview',
      params: { fileId: 'file_1', source: { name: 'report.md', url: `${ORIGIN}/f/file_1` } },
    });
  });

  it('opens the public link in a new tab when the visitor label names no file type', () => {
    expect(
      getFileLinkOpenAction({ ...link, isShareVisitor: true, label: 'Download the deck' }),
    ).toEqual({ kind: 'newTab', url: `${ORIGIN}/f/file_1` });
  });
});
