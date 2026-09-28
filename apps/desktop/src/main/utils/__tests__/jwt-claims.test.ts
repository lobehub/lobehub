import { describe, expect, it } from 'vitest';

import { describeJwtClaims, readJwtClaims } from '../jwt-claims';

const makeJwt = (payload: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(
    JSON.stringify(payload),
  ).toString('base64url')}.sig`;

describe('jwt-claims', () => {
  it('reads sub/exp/iat/client_id without verifying', () => {
    expect(
      readJwtClaims(makeJwt({ client_id: 'desktop', exp: 200, iat: 100, sub: 'user_abc' })),
    ).toEqual({ clientId: 'desktop', exp: 200, iat: 100, sub: 'user_abc' });
  });

  it('returns null for non-JWT tokens', () => {
    expect(readJwtClaims('opaque-token')).toBeNull();
    expect(readJwtClaims('a.!!!.c')).toBeNull();
  });

  it('describes an expired token with how long ago it expired', () => {
    const now = 1_000_000_000_000;
    const description = describeJwtClaims(
      makeJwt({ client_id: 'desktop', exp: now / 1000 - 90, sub: 'user_abcdefghijk' }),
      now,
    );
    expect(description).toBe(
      'token{sub=user_abc client=desktop exp=2001-09-09T01:45:10.000Z expiredBy=90s}',
    );
  });

  it('describes a live token with remaining seconds', () => {
    const now = 1_000_000_000_000;
    expect(describeJwtClaims(makeJwt({ exp: now / 1000 + 30 }), now)).toContain('expiresIn=30s');
  });

  it('labels missing and opaque tokens', () => {
    expect(describeJwtClaims(null)).toBe('token=none');
    expect(describeJwtClaims('opaque')).toBe('token=opaque');
  });
});
