import { describe, expect, it } from 'vitest';

import { toAnnotation, toSummary } from './annotate';

const diagnostic = {
  filePath: '/repo/apps/server/src/services/x.ts',
  loc: { start: { column: 0, line: 12 } },
  message: 'Promise.all fans out over rows, 100% of them\nSuggestion: use pMap',
  ruleId: 'lobehub/pmap-over-promise-all',
  severity: 'warn' as const,
};

describe('toAnnotation', () => {
  it('emits a warning command on the finding line with escaped data', () => {
    expect(toAnnotation(diagnostic, '/repo')).toBe(
      '::warning file=apps/server/src/services/x.ts,line=12,title=lobehub/pmap-over-promise-all::Promise.all fans out over rows, 100%25 of them',
    );
  });

  it('maps alint errors to error annotations and defaults the line', () => {
    expect(toAnnotation({ ...diagnostic, loc: undefined, severity: 'error' }, '/repo')).toMatch(
      /^::error file=apps\/server\/src\/services\/x\.ts,line=1,/,
    );
  });
});

describe('toSummary', () => {
  it('renders a header and one table row per finding', () => {
    const summary = toSummary(
      {
        diagnostics: [diagnostic],
        execution: { cached: 3, planned: 5 },
        usage: { totalTokens: 900 },
      },
      '/repo',
    );
    expect(summary).toContain('1 finding · 5 files (3 cached) · 900 tokens');
    expect(summary).toContain(
      '| `apps/server/src/services/x.ts:12` | lobehub/pmap-over-promise-all |',
    );
  });

  it('skips the table when there is nothing to report', () => {
    expect(toSummary({ diagnostics: [] }, '/repo')).toBe(
      '### alint · 0 findings · 0 files (0 cached) · 0 tokens\n',
    );
  });
});
