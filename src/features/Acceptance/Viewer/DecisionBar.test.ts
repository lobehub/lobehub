import { describe, expect, it } from 'vitest';

import verify from '../../../../packages/locales/src/default/verify';

describe('DecisionBar copy', () => {
  it('uses the copy prompt as the repair handoff', () => {
    expect(verify['acceptance.bar.copyReview']).toBe('Copy review prompt');
  });
});
