import { describe, expect, it } from 'vitest';

import {
  accessTokenTTL,
  defaultResourceFor,
  extensionCorsDecision,
  extensionResourceServer,
  isAcceptanceReviewAudience,
  isAcceptanceReviewIssued,
  reviewResourceServer,
} from './acceptanceReview';

const RESOURCE = 'urn:lobehub:acceptance:7f0c9a7e-0000-4000-8000-000000000001';

describe('reviewResourceServer', () => {
  it('issues an eight hour JWT scoped to the one acceptance for the review client', () => {
    expect(reviewResourceServer('lobehub-acceptance', RESOURCE)).toEqual({
      accessTokenFormat: 'jwt',
      accessTokenTTL: 8 * 60 * 60,
      audience: RESOURCE,
      scope: 'acceptance:review',
    });
  });

  it('refuses to widen the review client to the full API audience', () => {
    expect(reviewResourceServer('lobehub-acceptance', 'urn:lobehub:chat')).toBe('reject');
    expect(reviewResourceServer('lobehub-acceptance', 'urn:lobehub:acceptance:../x')).toBe(
      'reject',
    );
  });

  it('refuses a request naming more than one acceptance, since consent names only one', () => {
    const other = 'urn:lobehub:acceptance:7f0c9a7e-0000-4000-8000-000000000002';
    expect(reviewResourceServer('lobehub-acceptance', RESOURCE, [RESOURCE, other])).toBe('reject');
    expect(reviewResourceServer('lobehub-acceptance', RESOURCE, [RESOURCE])).toMatchObject({
      audience: RESOURCE,
    });
    expect(reviewResourceServer('lobehub-acceptance', RESOURCE, RESOURCE)).toMatchObject({
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
    expect(
      reviewResourceServer('lobehub-acceptance', SITE, SITE, { route: 'authorization' }),
    ).toEqual({
      accessTokenFormat: 'jwt',
      accessTokenTTL: 8 * 60 * 60,
      audience: SITE,
      scope: 'acceptance:review',
    });
    expect(
      reviewResourceServer('lobehub-acceptance', SITE, SITE, {
        grantType: 'authorization_code',
        route: 'token',
      }),
    ).toMatchObject({ audience: SITE });
  });

  it('refuses a site through the device flow, which has no origin to hand the result back to', () => {
    expect(
      reviewResourceServer('lobehub-acceptance', SITE, SITE, { route: 'device_authorization' }),
    ).toBe('reject');
    expect(
      reviewResourceServer('lobehub-acceptance', SITE, SITE, {
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        route: 'token',
      }),
    ).toBe('reject');
    expect(
      reviewResourceServer('lobehub-acceptance', SITE, SITE, { route: 'code_verification' }),
    ).toBe('reject');
  });

  it('counts a site audience as review-issued so it never passes as an app session', () => {
    expect(isAcceptanceReviewAudience(SITE)).toBe(true);
  });
});

describe('extension resource', () => {
  const EXTENSION = 'lobehub-acceptance-extension';
  const AUDIENCE = 'urn:lobehub:acceptance-extension';

  it('issues a one hour JWT for the extension audience only', () => {
    expect(extensionResourceServer(EXTENSION, AUDIENCE)).toEqual({
      accessTokenFormat: 'jwt',
      accessTokenTTL: 60 * 60,
      audience: AUDIENCE,
      scope: 'acceptance:extension',
    });
  });

  it('refuses to widen the extension client to the app or a review audience', () => {
    expect(extensionResourceServer(EXTENSION, 'urn:lobehub:chat')).toBe('reject');
    expect(extensionResourceServer(EXTENSION, RESOURCE)).toBe('reject');
  });

  it('leaves other clients alone', () => {
    expect(extensionResourceServer('lobehub-desktop', AUDIENCE)).toBeNull();
    expect(extensionResourceServer(undefined, AUDIENCE)).toBeNull();
  });

  it('defaults the extension client to its own audience and everyone else to the app', () => {
    expect(defaultResourceFor(EXTENSION, 'urn:lobehub:chat')).toBe(AUDIENCE);
    expect(defaultResourceFor('lobehub-desktop', 'urn:lobehub:chat')).toBe('urn:lobehub:chat');
  });

  it('counts anything the extension client was issued as never an app session', () => {
    expect(isAcceptanceReviewIssued({ aud: AUDIENCE })).toBe(true);
    expect(isAcceptanceReviewIssued({ aud: 'urn:lobehub:chat', client_id: EXTENSION })).toBe(true);
    expect(isAcceptanceReviewIssued({ aud: EXTENSION })).toBe(true);
    expect(
      isAcceptanceReviewIssued({ aud: 'urn:lobehub:chat', client_id: 'lobehub-desktop' }),
    ).toBe(false);
  });
});

describe('extensionCorsDecision', () => {
  it('lets the pinned extension call the token endpoint from its own origin', () => {
    expect(
      extensionCorsDecision(
        'lobehub-acceptance-extension',
        'chrome-extension://fjgpjfdackkmgdldjiebkhkdacbibhnb',
      ),
    ).toBe(true);
  });

  it('refuses any other origin for the extension client', () => {
    expect(
      extensionCorsDecision(
        'lobehub-acceptance-extension',
        'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(false);
    expect(extensionCorsDecision('lobehub-acceptance-extension', 'https://evil.example')).toBe(
      false,
    );
  });

  it('leaves other clients to the redirect-origin rule', () => {
    expect(
      extensionCorsDecision(
        'lobehub-desktop',
        'chrome-extension://fjgpjfdackkmgdldjiebkhkdacbibhnb',
      ),
    ).toBeNull();
  });
});

describe('origin-bound acceptance resources', () => {
  const BOUND =
    'urn:lobehub:acceptance:7f0c9a7e-0000-4000-8000-000000000001:https%3A%2F%2Fpr-12.preview.app';

  it('issues an eight hour JWT for an acceptance bound to its preview origin', () => {
    expect(
      reviewResourceServer('lobehub-acceptance', BOUND, BOUND, { route: 'authorization' }),
    ).toMatchObject({ accessTokenTTL: 8 * 60 * 60, audience: BOUND });
  });
});
