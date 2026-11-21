import { describe, expect, it } from 'vitest';

import { parseJSON } from './json';
import { parseJSONL } from './jsonl';

describe('columns across dataset records', () => {
  const rows = [{ input: 'first' }, { expected: 'answer', input: 'second' }, { tags: ['extra'] }];

  it('includes fields that are absent from the first JSON record', () => {
    expect(parseJSON(JSON.stringify(rows)).headers).toEqual(['input', 'expected', 'tags']);
  });

  it('includes fields from each parsed JSONL record in first-seen order', () => {
    expect(parseJSONL(rows.map((row) => JSON.stringify(row)).join('\n')).headers).toEqual([
      'input',
      'expected',
      'tags',
    ]);
  });

  it('finds columns after an empty first record', () => {
    expect(parseJSON('[{}, {"input":"question"}]').headers).toEqual(['input']);
    expect(parseJSONL('{}\n{"input":"question"}').headers).toEqual(['input']);
  });

  it('keeps preview row limits and total counts', () => {
    const result = parseJSON(JSON.stringify(rows), { preview: 1 });
    expect(result.rows).toEqual([rows[0]]);
    expect(result.totalCount).toBe(3);
    expect(result.headers).toEqual(['input', 'expected', 'tags']);
  });
});
