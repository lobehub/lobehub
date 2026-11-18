import { OAUTH_API_SCOPES } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import oauth from '@/locales/default/oauth';

import { scopeDescriptionKey } from './scopeDescription';

describe('scopeDescriptionKey', () => {
  it('maps every colon of a scope, so multi-part API scopes resolve', () => {
    expect(scopeDescriptionKey('agent:credential:write')).toBe(
      'consent.scope.agent-credential-write',
    );
    expect(scopeDescriptionKey('openid')).toBe('consent.scope.openid');
  });

  it('describes a site review differently from an acceptance review', () => {
    expect(scopeDescriptionKey('acceptance:review', 'site')).toBe(
      'consent.scope.acceptance-review-site',
    );
    expect(scopeDescriptionKey('acceptance:review', 'acceptance')).toBe(
      'consent.scope.acceptance-review',
    );
  });

  it('has a consent description for every API scope an OAuth client can request', () => {
    const missing = OAUTH_API_SCOPES.filter(
      (scope) => !(scopeDescriptionKey(scope) in (oauth as Record<string, string>)),
    );

    expect(missing).toEqual([]);
  });
});
