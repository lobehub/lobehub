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

  it('looks up a user-chosen slug, whose target only the server knows', () => {
    expect(needsAgentRouteLookup('my-bot')).toBe(true);
  });

  it('skips the lookup when there is no param at all', () => {
    expect(needsAgentRouteLookup()).toBe(false);
    expect(needsAgentRouteLookup('')).toBe(false);
  });
});

describe('resolveAgentRouteBranch', () => {
  it('waits instead of rendering the shell while the slug resolves', () => {
    expect(resolveAgentRouteBranch({ isLoading: true })).toBe('loading');
    // Even with a stale kind in hand, an in-flight resolution wins.
    expect(resolveAgentRouteBranch({ isLoading: true, kind: 'own' })).toBe('loading');
  });

  it('renders the creator surface for an own agent', () => {
    expect(resolveAgentRouteBranch({ isLoading: false, kind: 'own' })).toBe('own');
  });

  it('falls back to the creator surface, which owns the not-found card', () => {
    expect(resolveAgentRouteBranch({ isLoading: false, kind: 'notFound' })).toBe('own');
    expect(resolveAgentRouteBranch({ isLoading: false })).toBe('own');
  });
});
