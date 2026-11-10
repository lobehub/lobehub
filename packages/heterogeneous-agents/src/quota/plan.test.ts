import { describe, expect, it } from 'vitest';

import { displayPlanTier } from './plan';

describe('displayPlanTier', () => {
  it('shows a Max 20x account as Ultra, the name it was migrated to', () => {
    expect(displayPlanTier({ planTier: 'max', rateLimitTier: 'default_claude_max_20x' })).toBe(
      'ultra',
    );
  });

  it('keeps the $100 Max 5x plan as Max', () => {
    expect(displayPlanTier({ planTier: 'max', rateLimitTier: 'default_claude_max_5x' })).toBe(
      'max',
    );
  });

  it('passes other plans through, including one that already reports ultra', () => {
    expect(displayPlanTier({ planTier: 'ultra', rateLimitTier: 'default_claude_ultra' })).toBe(
      'ultra',
    );
    expect(displayPlanTier({ planTier: 'pro', rateLimitTier: null })).toBe('pro');
    expect(displayPlanTier({ planTier: 'max' })).toBe('max');
    // Codex reports its own plan names and no rate-limit tier.
    expect(displayPlanTier({ planTier: 'plus' })).toBe('plus');
  });

  it('shows nothing before the account reports a plan', () => {
    expect(displayPlanTier({ planTier: null, rateLimitTier: 'default_claude_max_20x' })).toBe(
      undefined,
    );
  });
});
