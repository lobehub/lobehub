import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it } from 'vitest';

import { needsAgentRouteLookup, resolveAgentRouteBranch } from './useAgentRouteResolution';

describe('needsAgentRouteLookup', () => {
  it('skips the lookup for id-shaped params', () => {
    expect(needsAgentRouteLookup('agt_123')).toBe(false);
    expect(needsAgentRouteLookup('agent_123')).toBe(false);
  });

  it('skips the lookup for builtin slugs, which the store already knows', () => {
    for (const slug of Object.values(BUILTIN_AGENT_SLUGS)) {
      expect([slug, needsAgentRouteLookup(slug)]).toEqual([slug, false]);
    }
  });

  it('looks up a user-chosen slug, which may be an agent or a share', () => {
    expect(needsAgentRouteLookup('my-bot')).toBe(true);
  });

  it('skips the lookup when there is no param at all', () => {
    expect(needsAgentRouteLookup()).toBe(false);
    expect(needsAgentRouteLookup('')).toBe(false);
  });
});

describe('resolveAgentRouteBranch', () => {
  it('waits instead of guessing a surface while the slug resolves', () => {
    expect(resolveAgentRouteBranch({ isLoading: true })).toBe('loading');
    // Even with a stale kind in hand, an in-flight resolution wins.
    expect(resolveAgentRouteBranch({ isLoading: true, kind: 'share' })).toBe('loading');
  });

  it('renders the creator surface for an own agent', () => {
    expect(resolveAgentRouteBranch({ isLoading: false, kind: 'own' })).toBe('own');
  });

  it('renders the visitor surface for a share', () => {
    expect(resolveAgentRouteBranch({ isLoading: false, kind: 'share' })).toBe('share');
  });

  it("redirects the creator's own share link instead of rendering the visitor surface", () => {
    expect(resolveAgentRouteBranch({ isLoading: false, kind: 'ownShare' })).toBe('ownShare');
  });

  it('falls back to the creator surface, which owns the not-found card', () => {
    expect(resolveAgentRouteBranch({ isLoading: false, kind: 'notFound' })).toBe('own');
    expect(resolveAgentRouteBranch({ isLoading: false })).toBe('own');
  });

  it('routes an UNAUTHORIZED lookup to the share surface, which owns the sign-in CTA', () => {
    const unauthorized = { data: { code: 'UNAUTHORIZED' } };

    expect(resolveAgentRouteBranch({ error: unauthorized, isLoading: false })).toBe('share');
    // Even with a stale/unset kind, an UNAUTHORIZED error wins over the fallback.
    expect(
      resolveAgentRouteBranch({ error: unauthorized, isLoading: false, kind: 'notFound' }),
    ).toBe('share');
  });

  it('keeps the creator fallback for a non-401 lookup failure', () => {
    const notFound = { data: { code: 'NOT_FOUND' } };

    expect(resolveAgentRouteBranch({ error: notFound, isLoading: false })).toBe('own');
    expect(resolveAgentRouteBranch({ error: new Error('network'), isLoading: false })).toBe('own');
  });
});
