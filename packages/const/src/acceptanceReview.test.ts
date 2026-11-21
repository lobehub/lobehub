import { describe, expect, it } from 'vitest';

import {
  acceptanceIdFromReviewResource,
  acceptanceReviewFromResource,
  acceptanceReviewResource,
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

describe('acceptance review resources', () => {
  const ID = '7f0c9a7e-0000-4000-8000-000000000001';

  it('round-trips an acceptance bound to the preview origin', () => {
    const resource = acceptanceReviewResource(ID, 'https://pr-12.preview.app');
    expect(resource).toBe(`urn:lobehub:acceptance:${ID}:https%3A%2F%2Fpr-12.preview.app`);
    expect(acceptanceReviewFromResource(resource)).toEqual({
      acceptanceId: ID,
      origin: 'https://pr-12.preview.app',
    });
    expect(acceptanceIdFromReviewResource(resource)).toBe(ID);
    expect(isReviewResource(resource)).toBe(true);
  });

  it('still reads the legacy form that carries no origin', () => {
    expect(acceptanceReviewFromResource(`urn:lobehub:acceptance:${ID}`)).toEqual({
      acceptanceId: ID,
    });
    expect(acceptanceIdFromReviewResource(`urn:lobehub:acceptance:${ID}`)).toBe(ID);
  });

  it('rejects anything else', () => {
    expect(acceptanceReviewFromResource('urn:lobehub:acceptance:../x')).toBeUndefined();
    expect(acceptanceReviewFromResource(`urn:lobehub:acceptance:${ID}:%E0%A4%A`)).toBeUndefined();
    expect(acceptanceReviewFromResource(42)).toBeUndefined();
  });
});
