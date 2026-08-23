import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { formatAcceptanceCountsText, resolveAcceptanceVerdictMeta } from './verdict';

const t = ((key: string) => key) as TFunction<'verify'>;

describe('resolveAcceptanceVerdictMeta', () => {
  it('treats repairing as an in-progress task, not a settled verdict', () => {
    const meta = resolveAcceptanceVerdictMeta('repairing', t);
    expect(meta.label).toBe('acceptance.status.repairing');
    expect(meta.spin).toBe(true);
  });

  it('treats accepted as a terminal success', () => {
    expect(resolveAcceptanceVerdictMeta('accepted', t).label).toBe('acceptance.status.accepted');
  });
});

describe('formatAcceptanceCountsText', () => {
  it('joins only the counts that are present', () => {
    expect(
      formatAcceptanceCountsText(t, { failed: 1, notExecuted: 0, passed: 3, uncertain: 0 }),
    ).toBe('acceptance.stats.passed · acceptance.stats.failed');
  });
});
