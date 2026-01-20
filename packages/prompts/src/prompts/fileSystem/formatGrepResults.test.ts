import { describe, expect, it } from 'vitest';

import { formatGrepResults } from './formatGrepResults';

describe('formatGrepResults', () => {
  it('should format empty results', () => {
    const result = formatGrepResults({
      matches: [],
      totalMatches: 0,
    });
    expect(result).toMatchInlineSnapshot(`"Found 0 matches in 0 locations"`);
  });

  it('should format single match', () => {
    const result = formatGrepResults({
      matches: ['/src/index.ts:10: const foo = "bar"'],
      totalMatches: 1,
    });
    expect(result).toMatchInlineSnapshot(`
      "Found 1 matches in 1 locations:
        /src/index.ts:10: const foo = "bar""
    `);
  });

  it('should format multiple matches', () => {
    const result = formatGrepResults({
      matches: ['/src/index.ts:10: match1', '/src/utils.ts:20: match2', '/src/types.ts:30: match3'],
      totalMatches: 5,
    });
    expect(result).toMatchInlineSnapshot(`
      "Found 5 matches in 3 locations:
        /src/index.ts:10: match1
        /src/utils.ts:20: match2
        /src/types.ts:30: match3"
    `);
  });

  it('should truncate matches exceeding maxDisplay', () => {
    const matches = Array.from({ length: 25 }, (_, i) => `match${i + 1}`);
    const result = formatGrepResults({
      matches,
      totalMatches: 100,
    });
    expect(result).toMatchInlineSnapshot(`
      "Found 100 matches in 25 locations:
        match1
        match2
        match3
        match4
        match5
        match6
        match7
        match8
        match9
        match10
        match11
        match12
        match13
        match14
        match15
        match16
        match17
        match18
        match19
        match20
        ... and 5 more"
    `);
  });

  it('should respect custom maxDisplay', () => {
    const matches = ['match1', 'match2', 'match3', 'match4', 'match5'];
    const result = formatGrepResults({
      matches,
      maxDisplay: 3,
      totalMatches: 10,
    });
    expect(result).toMatchInlineSnapshot(`
      "Found 10 matches in 5 locations:
        match1
        match2
        match3
        ... and 2 more"
    `);
  });
});
