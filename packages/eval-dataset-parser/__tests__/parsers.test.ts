import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseCSV } from '../src/parsers/csv';
import { parseJSON } from '../src/parsers/json';
import { parseJSONL } from '../src/parsers/jsonl';
import { parseXLSX } from '../src/parsers/xlsx';

// ─── CSV ────────────────────────────────────────────────────────────────────

describe('parseCSV', () => {
  const basicCSV = 'name,age,city\nAlice,30,NYC\nBob,25,LA\nCarol,35,Chicago';

  it('should parse headers and rows correctly', () => {
    const result = parseCSV(basicCSV);
    expect(result.format).toBe('csv');
    expect(result.headers).toEqual(['name', 'age', 'city']);
    expect(result.totalCount).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ name: 'Alice', age: 30, city: 'NYC' });
  });

  it('should apply preview limit', () => {
    const result = parseCSV(basicCSV, { preview: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.totalCount).toBe(3);
  });

  it('should handle custom delimiter', () => {
    const tsvContent = 'name\tage\nAlice\t30\nBob\t25';
    const result = parseCSV(tsvContent, { csvDelimiter: '\t' });
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows[0]).toMatchObject({ name: 'Alice', age: 30 });
  });

  it('should handle empty CSV (only headers)', () => {
    const result = parseCSV('name,age\n');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.totalCount).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('should handle CSV with quoted fields', () => {
    const csv = 'name,bio\nAlice,"She said, hello"\nBob,Simple';
    const result = parseCSV(csv);
    expect(result.rows[0].bio).toBe('She said, hello');
  });

  it('should dynamically type numeric values', () => {
    const csv = 'id,score\n1,9.5\n2,8.0';
    const result = parseCSV(csv);
    expect(typeof result.rows[0].id).toBe('number');
    expect(typeof result.rows[0].score).toBe('number');
  });
});

// ─── JSON ────────────────────────────────────────────────────────────────────

describe('parseJSON', () => {
  const validJSON = JSON.stringify([
    { question: 'Q1', answer: 'A1' },
    { question: 'Q2', answer: 'A2' },
    { question: 'Q3', answer: 'A3' },
  ]);

  it('should parse a JSON array', () => {
    const result = parseJSON(validJSON);
    expect(result.format).toBe('json');
    expect(result.headers).toEqual(['question', 'answer']);
    expect(result.totalCount).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1]).toEqual({ question: 'Q2', answer: 'A2' });
  });

  it('should apply preview limit', () => {
    const result = parseJSON(validJSON, { preview: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.totalCount).toBe(3);
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseJSON('not json at all')).toThrow();
  });

  it('should throw when JSON is not an array', () => {
    expect(() => parseJSON('{"key":"value"}')).toThrow(
      'JSON file must contain an array of objects',
    );
  });

  it('should handle empty JSON array', () => {
    const result = parseJSON('[]');
    expect(result.headers).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('should extract headers from first object only', () => {
    const json = JSON.stringify([
      { a: 1, b: 2 },
      { a: 3, c: 4 }, // 'c' is extra
    ]);
    const result = parseJSON(json);
    expect(result.headers).toEqual(['a', 'b']);
  });
});

// ─── JSONL ────────────────────────────────────────────────────────────────────

describe('parseJSONL', () => {
  const validJSONL = '{"id":1,"text":"first"}\n{"id":2,"text":"second"}\n{"id":3,"text":"third"}';

  it('should parse JSONL lines', () => {
    const result = parseJSONL(validJSONL);
    expect(result.format).toBe('jsonl');
    expect(result.headers).toEqual(['id', 'text']);
    expect(result.totalCount).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ id: 1, text: 'first' });
  });

  it('should apply preview limit', () => {
    const result = parseJSONL(validJSONL, { preview: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.totalCount).toBe(3);
  });

  it('should throw on invalid JSON line with line number', () => {
    const bad = '{"id":1}\nnot-json\n{"id":3}';
    expect(() => parseJSONL(bad)).toThrow('Invalid JSON at line 2');
  });

  it('should skip blank lines', () => {
    const withBlanks = '{"id":1}\n\n{"id":2}\n';
    const result = parseJSONL(withBlanks);
    expect(result.totalCount).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it('should handle single-line JSONL', () => {
    const result = parseJSONL('{"only":"one"}');
    expect(result.totalCount).toBe(1);
    expect(result.rows[0]).toEqual({ only: 'one' });
  });

  it('should handle empty JSONL input', () => {
    const result = parseJSONL('');
    expect(result.totalCount).toBe(0);
    expect(result.rows).toHaveLength(0);
    expect(result.headers).toEqual([]);
  });
});

// ─── XLSX ────────────────────────────────────────────────────────────────────

function makeXLSXBuffer(rows: Record<string, any>[], sheetName = 'Sheet1'): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(buffer);
}

describe('parseXLSX', () => {
  const sampleRows = [
    { name: 'Alice', score: 95 },
    { name: 'Bob', score: 87 },
    { name: 'Carol', score: 72 },
  ];

  it('should parse XLSX data from Uint8Array', () => {
    const data = makeXLSXBuffer(sampleRows);
    const result = parseXLSX(data);
    expect(result.format).toBe('xlsx');
    expect(result.headers).toEqual(['name', 'score']);
    expect(result.totalCount).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].name).toBe('Alice');
    expect(result.metadata?.sheetName).toBe('Sheet1');
  });

  it('should apply preview limit', () => {
    const data = makeXLSXBuffer(sampleRows);
    const result = parseXLSX(data, { preview: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.totalCount).toBe(3);
  });

  it('should select sheet by name', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ x: 1 }]), 'First');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ y: 2 }]), 'Second');
    const data = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));

    const result = parseXLSX(data, { sheet: 'Second' });
    expect(result.metadata?.sheetName).toBe('Second');
    expect(result.headers).toEqual(['y']);
    expect(result.rows[0].y).toBe('2');
  });

  it('should select sheet by index', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ x: 1 }]), 'First');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ y: 2 }]), 'Second');
    const data = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));

    const result = parseXLSX(data, { sheet: 1 });
    expect(result.metadata?.sheetName).toBe('Second');
    expect(result.headers).toEqual(['y']);
  });

  it('should return empty result for nonexistent sheet name', () => {
    const data = makeXLSXBuffer(sampleRows, 'Data');
    const result = parseXLSX(data, { sheet: 'NonExistent' });
    expect(result.rows).toHaveLength(0);
    expect(result.headers).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.metadata?.sheetName).toBe('NonExistent');
  });

  it('should default to first sheet when no sheet option provided', () => {
    const data = makeXLSXBuffer(sampleRows, 'MySheet');
    const result = parseXLSX(data);
    expect(result.metadata?.sheetName).toBe('MySheet');
    expect(result.totalCount).toBe(3);
  });
});
