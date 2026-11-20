import { describe, expect, it } from 'vitest';

import { acceptanceReviewAnchorSchema } from './acceptanceReview';

const base = {
  intent: 'change',
  region: { height: 50, width: 80, x: 10, y: 20 },
  scroll: { x: 0, y: 0 },
  targets: [],
  url: 'https://site.test/app#/settings',
  v: 1,
  viewport: { dpr: 2, height: 800, width: 1280 },
};

const ref = { box: { height: 0.5, width: 0.5, x: 0.1, y: 0.2 }, selector: '#card', text: 'Card' };

describe('acceptanceReviewAnchorSchema', () => {
  it('keeps the route and region refs the SDK sends', () => {
    const parsed = acceptanceReviewAnchorSchema.parse({
      ...base,
      regionRefs: [ref, null],
      route: '/app#/settings',
    });
    expect(parsed.route).toBe('/app#/settings');
    expect(parsed.regionRefs).toEqual([ref, null]);
  });

  it('allows region ref selectors as long as target selectors', () => {
    const long = { ...ref, selector: 's'.repeat(2000) };
    expect(acceptanceReviewAnchorSchema.safeParse({ ...base, regionRefs: [long] }).success).toBe(
      true,
    );
  });

  it('still accepts anchors from older SDKs', () => {
    const parsed = acceptanceReviewAnchorSchema.parse(base);
    expect(parsed.route).toBeUndefined();
    expect(parsed.regionRefs).toBeUndefined();
  });

  it('rejects oversized routes and too many region refs', () => {
    expect(
      acceptanceReviewAnchorSchema.safeParse({ ...base, route: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(
      acceptanceReviewAnchorSchema.safeParse({
        ...base,
        regionRefs: Array.from({ length: 7 }, () => ref),
      }).success,
    ).toBe(false);
  });
});
