import { describe, expect, it } from 'vitest';

import {
  getFileLinkCopyHref,
  getFileLinkOpenAction,
  getFileLinkTargetHref,
  isShareVisitorContext,
  parseFileLinkHref,
  resolveAppOrigin,
} from './parse';

const ORIGIN = 'https://app.lobehub.com';

describe('parseFileLinkHref', () => {
  it('matches a same-origin absolute file proxy link', () => {
    expect(parseFileLinkHref(`${ORIGIN}/f/file_abc123`, ORIGIN)).toEqual({
      fileId: 'file_abc123',
      proxyHref: '/f/file_abc123',
      scope: 'active',
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
      proxyHref: '/f/file_ynz',
      scope: 'active',
    });
  });

  // Regression: an absolute `https://app.lobehub.com/f/x` previewed from a page
  // on another origin redirects cross-origin with a tainted Origin, so the
  // bucket refuses the preview's `fetch` of a text file.
  it('keeps the proxy root-relative so it resolves on the reading page', () => {
    expect(
      parseFileLinkHref('https://app.lobehub.com/f/file_ynz', 'https://lobehub.com')?.proxyHref,
    ).toBe('/f/file_ynz');
  });

  it('matches the legacy ?file= Docs link and a library item', () => {
    expect(parseFileLinkHref('https://lobehub.com/resource?file=file_ynz', ORIGIN)?.fileId).toBe(
      'file_ynz',
    );
    expect(parseFileLinkHref('/resource/library/kb_1?file=file_ynz', ORIGIN)).toEqual({
      fileId: 'file_ynz',
      proxyHref: '/f/file_ynz',
      scope: 'active',
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

  it('scopes a workspace-prefixed link to the active workspace only', () => {
    const href = `${ORIGIN}/acme/resource/file/file_ynz`;

    expect(parseFileLinkHref(href, ORIGIN, { activeWorkspaceSlug: 'acme' })).toEqual({
      fileId: 'file_ynz',
      proxyHref: '/f/file_ynz',
      scope: 'active',
    });
    expect(parseFileLinkHref(href, ORIGIN, { activeWorkspaceSlug: 'other' })?.scope).toBe(
      'foreign',
    );
  });

  // Regression: a shared workspace topic is read with no active workspace, so a
  // `/{slug}/resource/file/:id` link was not recognized and the visitor followed
  // the owner's Docs page instead of the public proxy.
  it('recognizes a workspace-prefixed link with no active workspace', () => {
    expect(parseFileLinkHref(`${ORIGIN}/acme/resource/file/file_ynz`, ORIGIN)).toEqual({
      fileId: 'file_ynz',
      proxyHref: '/f/file_ynz',
      scope: 'foreign',
    });
  });

  // Regression: inside a workspace an unprefixed Docs link names a personal
  // file; previewing it by id in the workspace scope showed it as unavailable.
  it('marks an unprefixed Docs link foreign inside a workspace', () => {
    const options = { activeWorkspaceSlug: 'acme' };

    expect(parseFileLinkHref('/resource/file/file_ynz', ORIGIN, options)?.scope).toBe('foreign');
    expect(parseFileLinkHref('/resource?file=file_ynz', ORIGIN, options)?.scope).toBe('foreign');
    // The file proxy is addressed by id alone, in every scope.
    expect(parseFileLinkHref('/f/file_ynz', ORIGIN, options)?.scope).toBe('active');
  });

  it('does not take an unrelated two-segment path for a workspace link', () => {
    expect(parseFileLinkHref('/acme/settings', ORIGIN)).toBeNull();
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

describe('isShareVisitorContext', () => {
  it('treats the owner conversation as the owner', () => {
    expect(isShareVisitorContext({})).toBe(false);
  });

  // Regression: a topic-share reader got the owner-scoped preview, which reads
  // the visitor's empty file store and showed the file as unavailable.
  it('treats agent-share and topic-share readers as visitors', () => {
    expect(isShareVisitorContext({ agentShareId: 'share_1' })).toBe(true);
    expect(isShareVisitorContext({ topicShareId: 'share_1' })).toBe(true);
  });
});

describe('getFileLinkCopyHref', () => {
  const link = {
    linkHref: '/resource/file/file_1',
    origin: ORIGIN,
    proxyHref: '/f/file_1',
  };

  it('copies the link as written for the owner, made absolute', () => {
    expect(getFileLinkCopyHref({ ...link, isShareVisitor: false })).toBe(
      `${ORIGIN}/resource/file/file_1`,
    );
  });

  it('copies the public proxy for a share visitor', () => {
    expect(getFileLinkCopyHref({ ...link, isShareVisitor: true })).toBe(`${ORIGIN}/f/file_1`);
  });

  it('copies nothing without an address', () => {
    expect(getFileLinkCopyHref({ isShareVisitor: false, origin: ORIGIN })).toBeUndefined();
  });
});

describe('getFileLinkTargetHref', () => {
  const link = { linkHref: '/resource/file/file_1', proxyHref: '/f/file_1' };

  it('points at the address as written for the owner', () => {
    expect(getFileLinkTargetHref({ ...link, isShareVisitor: false })).toBe('/resource/file/file_1');
  });

  // Regression: on a share page a modifier or middle click followed the anchor's
  // own href, the owner's Docs page, instead of the public proxy.
  it('points a share visitor at the public proxy', () => {
    expect(getFileLinkTargetHref({ ...link, isShareVisitor: true })).toBe('/f/file_1');
  });
});

describe('resolveAppOrigin', () => {
  const sources = {
    remoteServerUrl: () => 'https://hub.example.com/',
    windowOrigin: () => 'app://renderer',
  };

  // Regression: on desktop a copied root-relative link came out as
  // `app://renderer/f/...`, which opens nothing outside the desktop shell.
  it('uses the remote server on desktop, not the renderer origin', () => {
    expect(resolveAppOrigin({ ...sources, isDesktop: true })).toBe('https://hub.example.com');
  });

  it('uses the page origin on the web', () => {
    expect(resolveAppOrigin({ isDesktop: false, ...sources, windowOrigin: () => ORIGIN })).toBe(
      ORIGIN,
    );
  });
});
