import { describe, expect, it } from 'vitest';

import { previewReviewUrl } from './previewReview';

const round = (roundIndex: number, metadata: unknown) => ({ run: { metadata, roundIndex } });

describe('previewReviewUrl', () => {
  it('opens the latest round preview with the review toolbar activated', () => {
    expect(
      previewReviewUrl('acc-1', [
        round(1, { previewUrl: 'https://old.example.com/' }),
        round(2, { previewUrl: 'https://pr-12.example.com/app?tab=1#top' }),
      ]),
    ).toBe('https://pr-12.example.com/app?tab=1&lh-acceptance=acc-1#top');
  });

  it('offers nothing when the latest round was not deployed', () => {
    expect(
      previewReviewUrl('acc-1', [
        round(1, { previewUrl: 'https://x.example.com/' }),
        round(2, null),
      ]),
    ).toBeNull();
    expect(previewReviewUrl('acc-1', [])).toBeNull();
  });

  it('never turns a non-web address into a link', () => {
    expect(previewReviewUrl('acc-1', [round(1, { previewUrl: 'javascript:alert(1)' })])).toBeNull();
    expect(previewReviewUrl('acc-1', [round(1, { previewUrl: 'not a url' })])).toBeNull();
  });
});
