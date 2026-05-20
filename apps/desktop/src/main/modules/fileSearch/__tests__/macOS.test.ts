import { describe, expect, it, vi } from 'vitest';

import { buildFilenameKeywordExpression } from '../impl/macOS';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('buildFilenameKeywordExpression', () => {
  it('produces a single substring term for one keyword', () => {
    expect(buildFilenameKeywordExpression('package.json')).toBe(
      'kMDItemFSName == "*package.json*"cd',
    );
  });

  it('splits whitespace-separated keywords into AND-ed substring terms', () => {
    // Critical fix: a free-form keyword string from the LLM (e.g. "LobeHub
    // Financial Statement") used to require that exact phrase to appear in the
    // filename. Real files reorder words and use _/-/. as separators, so the
    // literal phrase almost never matched. AND-ing per-token substrings keeps
    // each token literal but removes the order constraint.
    expect(buildFilenameKeywordExpression('LobeHub Financial Statement')).toBe(
      '(kMDItemFSName == "*LobeHub*"cd && kMDItemFSName == "*Financial*"cd && kMDItemFSName == "*Statement*"cd)',
    );
  });

  it('collapses repeated whitespace and trims surrounding spaces', () => {
    expect(buildFilenameKeywordExpression('  foo \t\n bar  ')).toBe(
      '(kMDItemFSName == "*foo*"cd && kMDItemFSName == "*bar*"cd)',
    );
  });

  it('escapes embedded double quotes in each token', () => {
    expect(buildFilenameKeywordExpression('foo "bar" baz')).toBe(
      '(kMDItemFSName == "*foo*"cd && kMDItemFSName == "*\\"bar\\"*"cd && kMDItemFSName == "*baz*"cd)',
    );
  });

  it('returns an empty string when keywords are blank', () => {
    expect(buildFilenameKeywordExpression('')).toBe('');
    expect(buildFilenameKeywordExpression('   \t  ')).toBe('');
  });
});
