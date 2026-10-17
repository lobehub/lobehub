import { describe, expect, it } from 'vitest';

import { deriveReportVerdict } from '.';

describe('deriveReportVerdict — headline fallback when summary.verdict is absent', () => {
  it('derives passed when every case passed', () => {
    expect(deriveReportVerdict([{ result: 'passed' }, { result: 'ok' }])).toBe('passed');
  });

  it('any failed case fails the report', () => {
    expect(deriveReportVerdict([{ result: 'passed' }, { result: 'failed' }])).toBe('failed');
  });

  it('a non-passed, non-failed case makes the report uncertain', () => {
    expect(deriveReportVerdict([{ result: 'passed' }, { result: 'blocked' }])).toBe('uncertain');
  });

  it('no cases → no derived verdict', () => {
    expect(deriveReportVerdict([])).toBeUndefined();
  });

  it('reads the documented `status` field, same as the per-case ingest', () => {
    // Regression: `status` was skipped here while the per-case ingest reads
    // `result ?? status ?? verdict`, so an all-pass report written with the
    // documented field derived `uncertain` whenever this fallback ran (e.g.
    // after the programmatic-test screen recounts the summary).
    expect(deriveReportVerdict([{ status: 'pass' }, { status: 'pass' }])).toBe('passed');
    expect(deriveReportVerdict([{ status: 'pass' }, { status: 'fail' }])).toBe('failed');
  });
});
