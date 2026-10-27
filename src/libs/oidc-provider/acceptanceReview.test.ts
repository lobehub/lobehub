import { describe, expect, it } from 'vitest';

import {
  accessTokenTTL,
  isAcceptanceReviewAudience,
  reviewResourceServer,
} from './acceptanceReview';

const RESOURCE = 'urn:lobehub:acceptance:7f0c9a7e-0000-4000-8000-000000000001';

describe('reviewResourceServer', () => {
  it('issues an eight hour JWT scoped to the one acceptance for the review client', () => {
    expect(reviewResourceServer('lobehub-review', RESOURCE)).toEqual({
      accessTokenFormat: 'jwt',
      accessTokenTTL: 8 * 60 * 60,
      audience: RESOURCE,
      scope: 'acceptance:review',
    });
  });

  it('refuses to widen the review client to the full API audience', () => {
    expect(reviewResourceServer('lobehub-review', 'urn:lobehub:chat')).toBe('reject');
    expect(reviewResourceServer('lobehub-review', 'urn:lobehub:acceptance:../x')).toBe('reject');
  });

  it('refuses a request naming more than one acceptance, since consent names only one', () => {
    const other = 'urn:lobehub:acceptance:7f0c9a7e-0000-4000-8000-000000000002';
    expect(reviewResourceServer('lobehub-review', RESOURCE, [RESOURCE, other])).toBe('reject');
    expect(reviewResourceServer('lobehub-review', RESOURCE, [RESOURCE])).toMatchObject({
      audience: RESOURCE,
    });
    expect(reviewResourceServer('lobehub-review', RESOURCE, RESOURCE)).toMatchObject({
      audience: RESOURCE,
    });
  });

  it('leaves other clients to the default resource rules', () => {
    expect(reviewResourceServer('lobehub-cli', 'urn:lobehub:chat')).toBeNull();
    expect(reviewResourceServer('lobehub-cli', RESOURCE)).toBeNull();
    expect(reviewResourceServer(undefined, 'urn:lobehub:chat')).toBeNull();
  });
});

describe('accessTokenTTL', () => {
  it('uses the resource server lifetime when it has one', () => {
    expect(accessTokenTTL({ resourceServer: { accessTokenTTL: 28_800 } }, 604_800)).toBe(28_800);
  });

  it('falls back to the default lifetime', () => {
    expect(accessTokenTTL({ resourceServer: {} }, 604_800)).toBe(604_800);
    expect(accessTokenTTL({}, 604_800)).toBe(604_800);
  });
});

describe('isAcceptanceReviewAudience', () => {
  it('recognizes review audiences, alone or in a list', () => {
    expect(isAcceptanceReviewAudience(RESOURCE)).toBe(true);
    expect(isAcceptanceReviewAudience(['urn:lobehub:chat', RESOURCE])).toBe(true);
  });

  it('ignores every other audience', () => {
    expect(isAcceptanceReviewAudience('urn:lobehub:chat')).toBe(false);
    expect(isAcceptanceReviewAudience(undefined)).toBe(false);
    expect(isAcceptanceReviewAudience(['urn:lobehub:hetero-operation'])).toBe(false);
  });
});

describe('site review resources', () => {
  const SITE = 'urn:lobehub:site:psite_7f3k9q2mAbCd:https%3A%2F%2Ffieldnotes.app';

  it('issues an eight hour JWT for a site through the browser code flow', () => {
    expect(reviewResourceServer('lobehub-review', SITE, SITE, { route: 'authorization' })).toEqual({
      accessTokenFormat: 'jwt',
      accessTokenTTL: 8 * 60 * 60,
      audience: SITE,
      scope: 'acceptance:review',
    });
    expect(
      reviewResourceServer('lobehub-review', SITE, SITE, {
        grantType: 'authorization_code',
        route: 'token',
      }),
    ).toMatchObject({ audience: SITE });
  });

  it('refuses a site through the device flow, which has no origin to hand the result back to', () => {
    expect(
      reviewResourceServer('lobehub-review', SITE, SITE, { route: 'device_authorization' }),
    ).toBe('reject');
    expect(
      reviewResourceServer('lobehub-review', SITE, SITE, {
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        route: 'token',
      }),
    ).toBe('reject');
    expect(reviewResourceServer('lobehub-review', SITE, SITE, { route: 'code_verification' })).toBe(
      'reject',
    );
  });

  it('counts a site audience as review-issued so it never passes as an app session', () => {
    expect(isAcceptanceReviewAudience(SITE)).toBe(true);
  });
});
