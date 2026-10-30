import { describe, expect, it } from 'vitest';

import { reviewStepStates } from './reviewSteps';

describe('reviewStepStates', () => {
  it('puts a dry-run approval after the draft and before publishing', () => {
    expect(reviewStepStates('dryRun')).toEqual([
      { state: 'done', step: 'draft' },
      { state: 'current', step: 'dryRun' },
      { state: 'upcoming', step: 'publish' },
    ]);
  });

  it('shows the dry run as behind a publish approval, so it does not read as a repeat', () => {
    expect(reviewStepStates('publish')).toEqual([
      { state: 'done', step: 'draft' },
      { state: 'done', step: 'dryRun' },
      { state: 'current', step: 'publish' },
    ]);
  });
});
