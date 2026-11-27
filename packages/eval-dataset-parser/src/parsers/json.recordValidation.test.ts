import { describe, expect, it } from 'vitest';

import { parseJSON } from './json';
import { parseJSONL } from './jsonl';

describe('dataset object records', () => {
  it.each([null, false, 42, 'text', []].map((row) => ({ row })))(
    'rejects a non-object JSON row: %j',
    ({ row }) => {
      expect(() => parseJSON(JSON.stringify([{ input: 'valid' }, row]))).toThrow('row 2');
    },
  );

  it.each([null, false, 42, 'text', []].map((row) => ({ row })))(
    'rejects a non-object JSONL record: %j',
    ({ row }) => {
      expect(() => parseJSONL(`{"input":"valid"}\n\n${JSON.stringify(row)}`)).toThrow('line 3');
    },
  );

  it('reports physical source lines for invalid JSON after blank lines', () => {
    expect(() => parseJSONL('\n{"input":"valid"}\n\nnot-json')).toThrow('line 4');
  });

  it('retains object rows with nested values', () => {
    const row = { input: ['question'], expected: { answer: 42 } };
    expect(parseJSON(JSON.stringify([row])).rows).toEqual([row]);
    expect(parseJSONL(JSON.stringify(row)).rows).toEqual([row]);
  });
});
