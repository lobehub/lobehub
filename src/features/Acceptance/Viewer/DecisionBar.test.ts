import { describe, expect, it } from 'vitest';

import verify from '../../../../packages/locales/src/default/verify';

describe('DecisionBar copy', () => {
  it('keeps the copy prompt action and uses Fix for rerunning the repair', () => {
    // Regression (#18843): the rerun handoff was collapsed into copy-only.
    // Embedded drafts into the composer; standalone dispatches to the origin
    // conversation — both hang off these keys.
    expect(verify['acceptance.bar.copyReview']).toBe('Copy review prompt');
    expect(verify['acceptance.bar.rerun']).toBe('Fix');
    expect(verify['acceptance.bar.rerunDrafted']).toBe(
      'Drafted into your composer — review and send it.',
    );
    expect(verify['acceptance.bar.rerunSent']).toBe(
      'Sent to the origin conversation — the repair round is starting.',
    );
  });
});
