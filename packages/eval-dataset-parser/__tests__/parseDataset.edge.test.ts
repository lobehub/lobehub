import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseDataset } from '../src';

function makeXLSXBuffer(rows: Record<string, any>[], sheetName = 'Sheet1'): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(buffer);
}

describe('parseDataset - XLSX', () => {
  const rows = [
    { question: 'Q1', answer: 'A1' },
    { question: 'Q2', answer: 'A2' },
  ];

  it('should parse XLSX from Uint8Array', () => {
    const data = makeXLSXBuffer(rows);
    const result = parseDataset(data, { format: 'xlsx' });
    expect(result.format).toBe('xlsx');
    expect(result.headers).toEqual(['question', 'answer']);
    expect(result.totalCount).toBe(2);
  });

  it('should auto-detect XLSX from magic bytes', () => {
    const data = makeXLSXBuffer(rows);
    const result = parseDataset(data);
    expect(result.format).toBe('xlsx');
  });

  it('should auto-detect XLSX by filename', () => {
    const data = makeXLSXBuffer(rows);
    const result = parseDataset(data, { filename: 'test.xlsx' });
    expect(result.format).toBe('xlsx');
    expect(result.totalCount).toBe(2);
  });

  it('should throw when XLSX format is used with string input', () => {
    expect(() => parseDataset('some string', { format: 'xlsx' })).toThrow(
      'XLSX format requires binary input',
    );
  });

  it('should support preview for XLSX', () => {
    const manyRows = Array.from({ length: 10 }, (_, i) => ({ id: i, val: `v${i}` }));
    const data = makeXLSXBuffer(manyRows);
    const result = parseDataset(data, { format: 'xlsx', preview: 3 });
    expect(result.rows).toHaveLength(3);
    expect(result.totalCount).toBe(10);
  });
});

describe('parseDataset - Buffer input', () => {
  it('should parse CSV from Buffer', () => {
    const csv = 'a,b\n1,2\n3,4';
    const buf = Buffer.from(csv, 'utf8');
    const result = parseDataset(buf, { format: 'csv' });
    expect(result.format).toBe('csv');
    expect(result.headers).toEqual(['a', 'b']);
    expect(result.totalCount).toBe(2);
  });

  it('should parse JSON from Buffer', () => {
    const json = '[{"x":1},{"x":2}]';
    const buf = Buffer.from(json, 'utf8');
    const result = parseDataset(buf, { format: 'json' });
    expect(result.format).toBe('json');
    expect(result.totalCount).toBe(2);
  });

  it('should parse JSONL from Buffer', () => {
    const jsonl = '{"k":"v1"}\n{"k":"v2"}';
    const buf = Buffer.from(jsonl, 'utf8');
    const result = parseDataset(buf, { format: 'jsonl' });
    expect(result.format).toBe('jsonl');
    expect(result.totalCount).toBe(2);
  });
});

describe('parseDataset - error cases', () => {
  it('should throw for invalid JSON content', () => {
    expect(() => parseDataset('not-json', { format: 'json' })).toThrow();
  });

  it('should throw when JSON is not an array', () => {
    expect(() => parseDataset('{"a":1}', { format: 'json' })).toThrow(
      'JSON file must contain an array of objects',
    );
  });

  it('should throw on invalid JSONL line', () => {
    expect(() => parseDataset('{"a":1}\nbad-line', { format: 'jsonl' })).toThrow(
      'Invalid JSON at line 2',
    );
  });

  it('should use explicit format over auto-detection', () => {
    // Content looks like JSONL but format is forced to CSV
    const result = parseDataset('{"a":1}', { format: 'csv' });
    expect(result.format).toBe('csv');
  });

  it('should auto-detect when format is "auto"', () => {
    const json = '[{"a":1}]';
    const result = parseDataset(json, { format: 'auto' });
    expect(result.format).toBe('json');
  });
});
