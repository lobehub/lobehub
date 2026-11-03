import { describe, expect, it } from 'vitest';

import { detectFormat } from '../src';

describe('detectFormat', () => {
  it('should detect CSV by filename', () => {
    expect(detectFormat('', 'data.csv')).toBe('csv');
  });

  it('should detect XLSX by filename', () => {
    expect(detectFormat('', 'data.xlsx')).toBe('xlsx');
  });

  it('should detect JSON by filename', () => {
    expect(detectFormat('', 'data.json')).toBe('json');
  });

  it('should detect JSONL by filename', () => {
    expect(detectFormat('', 'data.jsonl')).toBe('jsonl');
  });

  it('should detect JSON from content', () => {
    expect(detectFormat('[{"a":1}]')).toBe('json');
  });

  it('should detect JSONL from content', () => {
    expect(detectFormat('{"a":1}\n{"a":2}')).toBe('jsonl');
  });

  it('should default to CSV for unknown content', () => {
    expect(detectFormat('col1,col2\nval1,val2')).toBe('csv');
  });
});
