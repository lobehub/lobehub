import { describe, expect, it } from 'vitest';

import { resolveAgentRouteParam } from './useAgentShareVisitorRoute';

describe('resolveAgentRouteParam', () => {
  it('reads the aid of a personal agent route', () => {
    expect(resolveAgentRouteParam('/agent/my-agent', null)).toBe('my-agent');
  });

  it('reads the aid of the workspace mirror', () => {
    expect(resolveAgentRouteParam('/acme/agent/my-agent', 'acme')).toBe('my-agent');
  });

  it('ignores nested creator routes, which never render the visitor surface', () => {
    expect(resolveAgentRouteParam('/agent/my-agent/docs', null)).toBeUndefined();
    expect(resolveAgentRouteParam('/acme/agent/my-agent/docs', 'acme')).toBeUndefined();
  });

  it('does not mistake a sibling three-segment route for the workspace mirror', () => {
    // `/community/agent/:slug` is a discover detail page, not an agent route.
    expect(resolveAgentRouteParam('/community/agent/some-slug', null)).toBeUndefined();
    expect(resolveAgentRouteParam('/community/agent/some-slug', 'acme')).toBeUndefined();
  });

  it('returns undefined for unrelated routes', () => {
    expect(resolveAgentRouteParam('/', null)).toBeUndefined();
    expect(resolveAgentRouteParam('/agent', null)).toBeUndefined();
    expect(resolveAgentRouteParam('/settings/common', null)).toBeUndefined();
  });
});
