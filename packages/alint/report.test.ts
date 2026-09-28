import { describe, expect, it } from 'vitest';

import {
  COMMENT_MARKER,
  toAnnotations,
  toConclusion,
  toFindings,
  toMarkdown,
  toTitle,
} from './report';

const diagnostic = (overrides: Record<string, unknown> = {}) => ({
  filePath: '/repo/apps/server/src/services/x.ts',
  loc: { start: { column: 0, line: 12 } },
  message: 'Promise.all fans out over rows | unbounded\nSuggestion: use pMap with a cap',
  ruleId: 'lobehub/pmap-over-promise-all',
  severity: 'error' as const,
  ...overrides,
});

describe('toFindings', () => {
  it('splits message and suggestion, strips the plugin prefix, and sorts errors first', () => {
    const findings = toFindings(
      {
        diagnostics: [
          diagnostic({
            filePath: '/repo/src/a.tsx',
            ruleId: 'lobehub/no-mode-flags',
            severity: 'warn',
          }),
          diagnostic(),
        ],
      },
      '/repo',
    );
    expect(findings.map((f) => [f.severity, f.rule, f.file])).toEqual([
      ['error', 'pmap-over-promise-all', 'apps/server/src/services/x.ts'],
      ['warning', 'no-mode-flags', 'src/a.tsx'],
    ]);
    expect(findings[0]).toMatchObject({
      line: 12,
      message: 'Promise.all fans out over rows | unbounded',
      suggestion: 'use pMap with a cap',
    });
  });

  it('prefers the suggestion carried in evidence by declarative rules', () => {
    const [finding] = toFindings(
      {
        diagnostics: [
          diagnostic({ evidence: { suggestion: 'cap it with pMap' }, message: 'fans out' }),
        ],
      },
      '/repo',
    );
    expect(finding).toMatchObject({ message: 'fans out', suggestion: 'cap it with pMap' });
  });

  it('drops calibration fixtures, which fire by design', () => {
    const findings = toFindings(
      { diagnostics: [diagnostic({ filePath: '/repo/packages/alint/fixtures/pmap/bad.ts' })] },
      '/repo',
    );
    expect(findings).toEqual([]);
  });
});

describe('verdict', () => {
  const error = toFindings({ diagnostics: [diagnostic()] }, '/repo');
  const warning = toFindings({ diagnostics: [diagnostic({ severity: 'warn' })] }, '/repo');

  it('fails the check only when an error-level finding exists', () => {
    expect(toConclusion(error)).toBe('failure');
    expect(toConclusion(warning)).toBe('neutral');
    expect(toConclusion([])).toBe('success');
  });

  it('titles the check with the counts', () => {
    expect(toTitle([...error, ...warning, ...warning])).toBe('1 error, 2 warnings');
    expect(toTitle([])).toBe('No findings on the changed lines');
  });

  it('maps severities to check-run annotation levels and caps them at 50', () => {
    expect(toAnnotations(error)[0]).toMatchObject({
      annotation_level: 'failure',
      path: 'apps/server/src/services/x.ts',
      start_line: 12,
      title: 'pmap-over-promise-all',
    });
    expect(toAnnotations(Array.from({ length: 60 }, () => warning[0]))).toHaveLength(50);
  });
});

describe('toMarkdown', () => {
  it('renders a marked comment with a linked row per finding and escaped cells', () => {
    const markdown = toMarkdown(toFindings({ diagnostics: [diagnostic()] }, '/repo'), {
      repo: 'lobehub/lobehub',
      runUrl: 'https://example.com/run',
      sha: 'abcdef1234567',
    });
    expect(markdown.startsWith(COMMENT_MARKER)).toBe(true);
    expect(markdown).toContain('### ❌ ALint · 1 error');
    expect(markdown).toContain(
      '[`apps/server/src/services/x.ts:12`](https://github.com/lobehub/lobehub/blob/abcdef1234567/apps/server/src/services/x.ts#L12)',
    );
    expect(markdown).toContain('Promise.all fans out over rows \\| unbounded');
    expect(markdown).toContain('💡 use pMap with a cap');
    expect(markdown).toContain('[run](https://example.com/run)');
  });

  it('renders a clean verdict when nothing was found', () => {
    expect(toMarkdown([], { repo: 'lobehub/lobehub', sha: 'abcdef1234567' })).toContain(
      '### ✅ ALint · No findings on the changed lines',
    );
  });
});
