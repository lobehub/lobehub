import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { detectFormat } from '../src/detect';

const XLSX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

describe('detectFormat - edge cases', () => {
  it('should detect XLS by filename extension', () => {
    expect(detectFormat('', 'data.xls')).toBe('xlsx');
  });

  it('should detect XLSX magic bytes from Uint8Array without filename', () => {
    // Create a real minimal XLSX binary
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['a']]), 'Sheet1');
    const buf = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const data = new Uint8Array(buf);

    const result = detectFormat(data);
    expect(result).toBe('xlsx');
  });

  it('should detect XLSX magic bytes from Buffer without filename', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['a']]), 'Sheet1');
    const buf = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;

    const result = detectFormat(buf);
    expect(result).toBe('xlsx');
  });

  it('should parse JSON from Uint8Array containing JSON array', () => {
    const json = '[{"a":1}]';
    const data = new TextEncoder().encode(json);
    expect(detectFormat(data)).toBe('json');
  });

  it('should parse JSONL from Uint8Array', () => {
    const jsonl = '{"a":1}\n{"b":2}';
    const data = new TextEncoder().encode(jsonl);
    expect(detectFormat(data)).toBe('jsonl');
  });

  it('should fall back to CSV from Uint8Array with CSV content', () => {
    const csv = 'col1,col2\nval1,val2';
    const data = new TextEncoder().encode(csv);
    expect(detectFormat(data)).toBe('csv');
  });

  it('should not detect XLSX from short Uint8Array (less than 4 bytes)', () => {
    const data = new Uint8Array([0x50, 0x4b]);
    // Not enough bytes for magic number → falls through to string detection
    expect(detectFormat(data)).toBe('csv');
  });

  it('filename extension takes precedence over content', () => {
    // Content looks like JSON but filename says CSV
    const json = '[{"a":1}]';
    expect(detectFormat(json, 'data.csv')).toBe('csv');
  });

  it('should treat a JSON-like string that fails parse as CSV', () => {
    // Starts with '[' but is not valid JSON
    const badJson = '[not valid json';
    expect(detectFormat(badJson)).toBe('csv');
  });

  it('should treat an object-like first line that fails parse as CSV', () => {
    // Starts with '{' on first line but is not valid JSON
    const badJsonL = '{not valid jsonl}\nmore data';
    expect(detectFormat(badJsonL)).toBe('csv');
  });
});
