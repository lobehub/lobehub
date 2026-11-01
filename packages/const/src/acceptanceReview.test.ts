import { describe, expect, it } from 'vitest';

import {
  acceptanceIdFromReviewResource,
  isReviewResource,
  siteReviewFromResource,
  siteReviewResource,
} from './acceptanceReview';

describe('site review resources', () => {
  it('round-trips a site ID and the page origin', () => {
    const resource = siteReviewResource('psite_7f3k9q2mAbCd', 'https://fieldnotes.app');
    expect(resource).toBe('urn:lobehub:site:psite_7f3k9q2mAbCd:https%3A%2F%2Ffieldnotes.app');
    expect(siteReviewFromResource(resource)).toEqual({
      origin: 'https://fieldnotes.app',
      siteId: 'psite_7f3k9q2mAbCd',
    });
  });

  it('reads the first entry of an audience array', () => {
    const resource = siteReviewResource('psite_7f3k9q2mAbCd', 'http://localhost:3000');
    expect(siteReviewFromResource([resource])).toEqual({
      origin: 'http://localhost:3000',
      siteId: 'psite_7f3k9q2mAbCd',
    });
  });

  it('rejects malformed site resources', () => {
    expect(siteReviewFromResource('urn:lobehub:site:psite_7f3k9q2mAbCd')).toBeUndefined();
    expect(siteReviewFromResource('urn:lobehub:site:nope:https%3A%2F%2Fa.co')).toBeUndefined();
    expect(siteReviewFromResource('urn:lobehub:site:psite_7f3k9q2mAbCd:%E0%A4%A')).toBeUndefined();
    expect(siteReviewFromResource(42)).toBeUndefined();
  });

  it('keeps acceptance and site resources apart', () => {
    const site = siteReviewResource('psite_7f3k9q2mAbCd', 'https://fieldnotes.app');
    expect(acceptanceIdFromReviewResource(site)).toBeUndefined();
    expect(siteReviewFromResource('urn:lobehub:acceptance:abc')).toBeUndefined();
  });

  it('recognises both kinds as review resources', () => {
    expect(isReviewResource('urn:lobehub:acceptance:abc')).toBe(true);
    expect(isReviewResource(siteReviewResource('psite_7f3k9q2mAbCd', 'https://a.co'))).toBe(true);
    expect(isReviewResource(['https://api.lobehub.com'])).toBe(false);
  });
});
