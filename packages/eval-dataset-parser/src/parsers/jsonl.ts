import type { ParseOptions, ParseResult } from '../types';

export function parseJSONL(content: string, options?: ParseOptions): ParseResult {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const totalCount = lines.length;
  const linesToParse = options?.preview ? lines.slice(0, options.preview) : lines;

  const rows = linesToParse.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON at line ${index + 1}: ${line.slice(0, 100)}`);
    }
  });

  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row ?? {})) columns.add(column);
  }
  const headers = [...columns];

  return {
    format: 'jsonl',
    headers,
    rows,
    totalCount,
  };
}
