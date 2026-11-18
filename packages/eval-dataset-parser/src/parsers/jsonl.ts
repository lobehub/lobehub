import type { ParseOptions, ParseResult } from '../types';

export function parseJSONL(content: string, options?: ParseOptions): ParseResult {
  const lines = content
    .split('\n')
    .map((line, index) => ({ content: line.trim(), number: index + 1 }))
    .filter((line) => line.content.length > 0);

  const totalCount = lines.length;
  const linesToParse = options?.preview ? lines.slice(0, options.preview) : lines;

  const rows = linesToParse.map((line) => {
    let row: unknown;
    try {
      row = JSON.parse(line.content);
    } catch {
      throw new Error(`Invalid JSON at line ${line.number}: ${line.content.slice(0, 100)}`);
    }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`JSONL line ${line.number} must be an object`);
    }
    return row as Record<string, any>;
  });

  const headers = Object.keys(rows[0] || {});

  return {
    format: 'jsonl',
    headers,
    rows,
    totalCount,
  };
}
