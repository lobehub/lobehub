import * as XLSX from 'xlsx';

import type { ParseOptions, ParseResult } from '../types';

export function parseXLSX(
  data: Buffer | Uint8Array,
  options?: ParseOptions,
): ParseResult {
  const workbook = XLSX.read(data, { type: 'array' });

  // Select sheet
  let sheetName: string;
  if (typeof options?.sheet === 'string') {
    sheetName = options.sheet;
  } else if (typeof options?.sheet === 'number') {
    sheetName = workbook.SheetNames[options.sheet] || workbook.SheetNames[0];
  } else {
    sheetName = workbook.SheetNames[0];
  }

  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    return { format: 'xlsx', headers: [], metadata: { sheetName }, rows: [], totalCount: 0 };
  }

  const allRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
    defval: '',
    raw: false,
  });

  const headers = Object.keys(allRows[0] || {});
  const rows = options?.preview ? allRows.slice(0, options.preview) : allRows;

  return {
    format: 'xlsx',
    headers,
    metadata: { sheetName },
    rows,
    totalCount: allRows.length,
  };
}
