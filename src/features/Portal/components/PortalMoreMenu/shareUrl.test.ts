import { describe, expect, it, vi } from 'vitest';

import { buildPortalShareUrl } from './shareUrl';

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));

describe('buildPortalShareUrl', () => {
  it('joins the app origin and the entity route', () => {
    expect(buildPortalShareUrl('https://app.lobehub.com', '/agent/agt_1', null)).toBe(
      'https://app.lobehub.com/agent/agt_1',
    );
  });

  it('carries the active workspace prefix', () => {
    expect(buildPortalShareUrl('https://app.lobehub.com', '/agent/agt_1/tpc_1', 'acme')).toBe(
      'https://app.lobehub.com/acme/agent/agt_1/tpc_1',
    );
  });

  it('keeps the query string of the route', () => {
    expect(
      buildPortalShareUrl('https://app.lobehub.com', '/agent/a/t?portalThread=thd_1', 'acme'),
    ).toBe('https://app.lobehub.com/acme/agent/a/t?portalThread=thd_1');
  });

  it('hides the link when the origin or the route is unknown', () => {
    // A relative link cannot be pasted anywhere useful — no link beats a broken one.
    expect(buildPortalShareUrl('', '/agent/agt_1', null)).toBeUndefined();
    expect(buildPortalShareUrl(undefined, '/agent/agt_1', null)).toBeUndefined();
    expect(buildPortalShareUrl('https://app.lobehub.com', undefined, null)).toBeUndefined();
  });
});
