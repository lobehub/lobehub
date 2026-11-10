import { describe, expect, it } from 'vitest';

import { verifyCriteria } from '../../schemas/verify';
import {
  buildContainsCondition,
  buildTextSearchCondition,
  coerceDate,
  escapeLikePattern,
  isPGliteDatabase,
} from '../userMemory/model/utils';

/** Collects the raw strings and bound values out of a drizzle SQL node. */
const sqlText = (node: unknown) => {
  const out: string[] = [];
  const walk = (current: any) => {
    if (!current || typeof current !== 'object') return;
    const chunks = current.queryChunks;
    if (!Array.isArray(chunks)) return;
    for (const chunk of chunks) {
      if (typeof chunk === 'string') out.push(chunk);
      else if (typeof chunk?.value === 'string') out.push(chunk.value);
      else if (Array.isArray(chunk?.value))
        out.push(...chunk.value.filter((v: unknown) => typeof v === 'string'));
      else walk(chunk);
    }
  };
  walk(node);
  return out.join(' ');
};

describe('coerceDate', () => {
  it('returns null for empty and unsupported input', () => {
    expect(coerceDate(null)).toBeNull();
    expect(coerceDate(undefined)).toBeNull();
    expect(coerceDate({})).toBeNull();
    expect(coerceDate(true)).toBeNull();
  });

  it('keeps a valid Date and drops an invalid one', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(coerceDate(date)).toBe(date);
    expect(coerceDate(new Date('not a date'))).toBeNull();
  });

  it('parses strings and numbers, rejecting unparsable ones', () => {
    expect(coerceDate('2026-01-02T03:04:05.000Z')?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(coerceDate(0)?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(coerceDate('not a date')).toBeNull();
    expect(coerceDate(Number.NaN)).toBeNull();
  });
});

describe('escapeLikePattern', () => {
  it('escapes backslashes, percent and underscore', () => {
    expect(escapeLikePattern('50%_off\\now')).toBe('50\\%\\_off\\\\now');
  });
});

describe('buildContainsCondition', () => {
  it('skips blank queries', () => {
    expect(buildContainsCondition(verifyCriteria.title)).toBeUndefined();
    expect(buildContainsCondition(verifyCriteria.title, '   ')).toBeUndefined();
  });

  it('builds an escaped ILIKE condition for a real query', () => {
    const condition = buildContainsCondition(verifyCriteria.title, ' 100%_done ');
    expect(condition).toBeDefined();
    expect(sqlText(condition)).toContain('%100\\%\\_done%');
  });
});

describe('isPGliteDatabase', () => {
  it('detects the pglite client by its waitReady/dataDir pair', () => {
    expect(isPGliteDatabase({ $client: { dataDir: 'idb://x', waitReady: true } } as never)).toBe(
      true,
    );
    expect(isPGliteDatabase({ $client: { dataDir: 'idb://x' } } as never)).toBe(false);
    expect(isPGliteDatabase({ $client: { waitReady: true } } as never)).toBe(false);
    expect(isPGliteDatabase({} as never)).toBe(false);
  });
});

describe('buildTextSearchCondition', () => {
  const groups = [
    {
      fallbackColumns: [verifyCriteria.title],
      fields: ['title'],
      keyColumn: verifyCriteria.id,
    },
  ];

  it('returns undefined without a normalized query', () => {
    expect(
      buildTextSearchCondition({
        bm25MatchQuery: 'plan',
        groups,
        normalizedQuery: '',
        supportsBm25: true,
      }),
    ).toBeUndefined();
  });

  it('builds a bm25 boolean condition when the engine supports it', () => {
    const condition = buildTextSearchCondition({
      bm25MatchQuery: 'plan',
      groups,
      normalizedQuery: 'plan',
      supportsBm25: true,
    });
    expect(condition).toBeDefined();
    expect(sqlText(condition)).toContain('paradedb');
  });

  it('skips bm25 groups without searchable fields', () => {
    expect(
      buildTextSearchCondition({
        bm25MatchQuery: 'plan',
        groups: [{ ...groups[0], fields: [] }],
        normalizedQuery: 'plan',
        supportsBm25: true,
      }),
    ).toBeUndefined();
  });

  it('falls back to contains conditions without bm25 support', () => {
    const condition = buildTextSearchCondition({
      bm25MatchQuery: 'plan',
      groups,
      normalizedQuery: 'plan',
      supportsBm25: false,
    });
    expect(condition).toBeDefined();
    expect(sqlText(condition)).toContain('ILIKE');
  });

  it('returns undefined when no fallback column is searchable', () => {
    expect(
      buildTextSearchCondition({
        bm25MatchQuery: 'plan',
        groups: [{ ...groups[0], fallbackColumns: [] }],
        normalizedQuery: 'plan',
        supportsBm25: false,
      }),
    ).toBeUndefined();
  });
});
