import { describe, expect, it } from 'vitest';

import { selectEarlierRunReport } from './runReport';

const report = `# Verification passed\n\n${'Every path reopened within 500 ms. '.repeat(20)}`;
const remark =
  'The background file search from earlier has finished. I had already used its output, so the verification results are unchanged.';

describe('selectEarlierRunReport', () => {
  it('returns the report a trailing remark followed', () => {
    const replies = [
      { content: remark },
      { content: report },
      { content: 'Cleaned up. Saving the new harness lessons to memory.' },
    ];

    expect(selectEarlierRunReport(replies, remark)).toBe(report.trim());
  });

  it('considers every row when the final reply was never persisted', () => {
    expect(selectEarlierRunReport([{ content: report }], remark)).toBe(report.trim());
  });

  it('ignores a run whose earlier replies are only progress notes', () => {
    const replies = [{ content: remark }, { content: 'Uploading screenshots.' }, { content: null }];

    expect(selectEarlierRunReport(replies, remark)).toBeUndefined();
  });

  it('ignores an earlier reply that is not clearly longer than the final one', () => {
    const final = report.slice(0, Math.ceil(report.length / 2) + 10);

    expect(
      selectEarlierRunReport([{ content: final }, { content: report }], final),
    ).toBeUndefined();
  });
});
