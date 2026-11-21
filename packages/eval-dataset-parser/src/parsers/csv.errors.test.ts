import { describe, expect, it } from 'vitest';

import { parseCSV } from './csv';

describe('malformed CSV datasets', () => {
  it('rejects an unterminated quoted field instead of importing merged records', () => {
    expect(() => parseCSV('input,expected\n"question,answer\nnext,result')).toThrow('CSV');
  });

  it('rejects surplus cells instead of hiding them under __parsed_extra', () => {
    expect(() => parseCSV('input,expected\nquestion,answer,orphan')).toThrow('CSV');
  });

  it('rejects missing cells while allowing explicit empty cells', () => {
    expect(() => parseCSV('input,expected\nquestion')).toThrow('CSV');
    expect(parseCSV('input,expected\nquestion,').rows).toEqual([
      { input: 'question', expected: null },
    ]);
  });

  it('retains valid single-column datasets when delimiter detection reports a warning', () => {
    expect(parseCSV('input\nfirst\nsecond').rows).toEqual([
      { input: 'first' },
      { input: 'second' },
    ]);
  });
});
