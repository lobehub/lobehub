import { clampSheetRefToData } from '@lobechat/file-loaders/src/xlsxBudget';
import * as XLSX from 'xlsx';

import type { ParseOptions, ParseResult } from '../types';

export function parseXLSX(data: Buffer | Uint8Array, options?: ParseOptions): ParseResult {
  if (
    options?.headerRow !== undefined &&
    (!Number.isInteger(options.headerRow) || options.headerRow < 0)
  ) {
    throw new Error('headerRow must be a non-negative integer');
  }
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

  // A declared used range can span a million styled-but-empty rows: clamp it to the real data
  clampSheetRefToData(worksheet);

  const allRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
    defval: '',
    range: options?.headerRow,
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
