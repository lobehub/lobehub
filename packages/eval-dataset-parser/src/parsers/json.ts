import type { ParseOptions, ParseResult } from '../types';

export function parseJSON(content: string, options?: ParseOptions): ParseResult {
  const data = JSON.parse(content);

  if (!Array.isArray(data)) {
    throw new Error('JSON file must contain an array of objects');
  }

  const headers = Object.keys(data[0] || {});
  const rows = options?.preview ? data.slice(0, options.preview) : data;

  return {
    format: 'json',
    headers,
    rows,
    totalCount: data.length,
  };
}
