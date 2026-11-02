import { describe, expect, it } from 'vitest';

import { buildGithubInstallHref } from './installHref';

const INSTALL_PATH = '/api/webhooks/github/install';
const ORIGIN = 'https://app.lobehub.com';

describe('buildGithubInstallHref', () => {
  it('keeps the app login origin and workspace scope when starting from the cloud gateway', () => {
    const href = buildGithubInstallHref(INSTALL_PATH, {
      appOrigin: 'https://lobehub.com/',
      workspaceId: 'ws_123',
      workspaceSlug: 'acme',
    });
    const url = new URL(href!);
    expect(url.origin).toBe('https://app.lobehub.com');
    expect(url.pathname).toBe(INSTALL_PATH);
    expect(url.searchParams.get('workspaceId')).toBe('ws_123');
    expect(url.searchParams.get('returnTo')).toBe('/acme/settings/integrations/github');
  });

  it('preserves a self-hosted install origin and path prefix', () => {
    const href = buildGithubInstallHref(INSTALL_PATH, {
      appOrigin: 'https://chat.example.com/lobe/',
    });
    expect(new URL(href!).origin).toBe('https://chat.example.com');
    expect(new URL(href!).pathname).toBe(`/lobe${INSTALL_PATH}`);
  });

  it('returns undefined until the app origin is known', () => {
    expect(buildGithubInstallHref(INSTALL_PATH, { workspaceId: null, workspaceSlug: null })).toBe(
      undefined,
    );
  });

  it('returns to the personal page outside a workspace, with no scope in the query', () => {
    const href = buildGithubInstallHref(INSTALL_PATH, {
      appOrigin: ORIGIN,
      workspaceId: null,
      workspaceSlug: null,
    });

    const url = new URL(href!);
    expect(url.pathname).toBe(INSTALL_PATH);
    expect(url.searchParams.get('returnTo')).toBe('/settings/integrations/github');
    expect(url.searchParams.get('workspaceId')).toBe(null);
  });

  it('carries the workspace id so the callback binds into the workspace, not the personal scope', () => {
    const href = buildGithubInstallHref(INSTALL_PATH, {
      appOrigin: ORIGIN,
      workspaceId: 'ws_123',
      workspaceSlug: 'acme',
    });

    const url = new URL(href!);
    expect(url.searchParams.get('workspaceId')).toBe('ws_123');
    expect(url.searchParams.get('returnTo')).toBe('/acme/settings/integrations/github');
  });
});
