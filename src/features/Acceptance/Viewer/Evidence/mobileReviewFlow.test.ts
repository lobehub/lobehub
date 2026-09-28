import { describe, expect, it } from 'vitest';

import { nextMobileReviewStep } from './mobileReviewFlow';

describe('nextMobileReviewStep', () => {
  it('stays on the image after a region is drawn', () => {
    // The regression: finishing a drag left the image for a separate note
    // screen, so the box could no longer be moved, resized or deleted.
    expect(nextMobileReviewStep('draw', 'region-drawn')).toBe('draw');
  });

  it('toggles between marking and browsing', () => {
    expect(nextMobileReviewStep('browse', 'toggle-draw')).toBe('draw');
    expect(nextMobileReviewStep('draw', 'toggle-draw')).toBe('browse');
  });

  it('opens a listed region ready to adjust, not merely to look at', () => {
    expect(nextMobileReviewStep('browse', 'edit-region')).toBe('draw');
    expect(nextMobileReviewStep('draw', 'edit-region')).toBe('draw');
  });
});
