import { detectFormat } from './detect';
import { parseCSV, parseJSON, parseJSONL, parseXLSX } from './parsers';
import type { ParseOptions, ParseResult } from './types';

export function parseDataset(
  input: Buffer | string | Uint8Array,
  options?: ParseOptions & { filename?: string },
): ParseResult {
  const format =
    options?.format && options.format !== 'auto'
      ? options.format
      : detectFormat(input, options?.filename);

  switch (format) {
    case 'csv': {
      const content = typeof input === 'string' ? input : new TextDecoder().decode(input);
      return parseCSV(content, options);
    }

    case 'xlsx': {
      if (typeof input === 'string') {
        throw new Error('XLSX format requires binary input (Buffer or Uint8Array)');
      }
      const data = input instanceof Uint8Array ? input : new Uint8Array(input);
      return parseXLSX(data, options);
    }

    case 'json': {
      const content = typeof input === 'string' ? input : new TextDecoder().decode(input);
      return parseJSON(content, options);
    }

    case 'jsonl': {
      const content = typeof input === 'string' ? input : new TextDecoder().decode(input);
      return parseJSONL(content, options);
    }

    default: {
      throw new Error(`Unsupported format: ${format}`);
    }
  }
}
