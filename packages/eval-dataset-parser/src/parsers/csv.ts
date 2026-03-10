import * as Papa from 'papaparse';

import type { ParseOptions, ParseResult } from '../types';

export function parseCSV(content: string, options?: ParseOptions): ParseResult {
  const result = Papa.parse<Record<string, any>>(content, {
    delimiter: options?.csvDelimiter,
    dynamicTyping: true,
    header: true,
    skipEmptyLines: true,
  });

  const rows = options?.preview ? result.data.slice(0, options.preview) : result.data;
  const headers = result.meta.fields || [];

  return {
    format: 'csv',
    headers,
    rows,
    totalCount: result.data.length,
  };
}
