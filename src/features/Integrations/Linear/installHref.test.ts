import { describe, expect, it } from 'vitest';

import { buildLinearInstallHref } from './installHref';

const PATH = '/api/webhooks/linear/install';

describe('buildLinearInstallHref', () => {
  it('returns nothing until the app origin is known', () => {
    expect(buildLinearInstallHref(PATH, {})).toBeUndefined();
  });

  it('returns to the personal settings page outside a workspace', () => {
    const href = new URL(buildLinearInstallHref(PATH, { appOrigin: 'https://app.test' })!);
    expect(href.pathname).toBe(PATH);
    expect(href.searchParams.get('returnTo')).toBe('/settings/integrations/linear');
    expect(href.searchParams.has('workspaceId')).toBe(false);
  });

  it('carries the workspace and mirrors the return path under its slug', () => {
    const href = new URL(
      buildLinearInstallHref(PATH, {
        appOrigin: 'https://app.test/',
        workspaceId: 'ws_1',
        workspaceSlug: 'acme',
      })!,
    );
    expect(href.searchParams.get('workspaceId')).toBe('ws_1');
    expect(href.searchParams.get('returnTo')).toBe('/acme/settings/integrations/linear');
  });

  it('starts a cloud-gateway install on the app login origin', () => {
    const href = new URL(
      buildLinearInstallHref(PATH, { appOrigin: 'https://lobehub.com/', workspaceSlug: 'acme' })!,
    );
    expect(href.origin).toBe('https://app.lobehub.com');
    expect(href.pathname).toBe(PATH);
    expect(href.searchParams.get('returnTo')).toBe('/acme/settings/integrations/linear');
  });
});
