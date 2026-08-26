import { describe, expect, it } from 'vitest';

import verify from '../../../../packages/locales/src/default/verify';

describe('DecisionBar copy', () => {
  it('keeps the copy prompt action and uses Fix for rerunning the repair', () => {
    expect(verify['acceptance.bar.copyReview']).toBe('Copy review prompt');
    expect(verify['acceptance.bar.rerun']).toBe('Fix');
  });
});
