import type { DatasetFormat } from './types';

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 (ZIP header)

export function detectFormat(
  input: Buffer | string | Uint8Array,
  filename?: string,
): DatasetFormat {
  // 1. Try filename extension
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'csv') return 'csv';
    if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
    if (ext === 'jsonl') return 'jsonl';
    if (ext === 'json') return 'json';
  }

  // 2. For binary data, check XLSX magic bytes
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length >= 4 && XLSX_MAGIC.every((b, i) => bytes[i] === b)) {
      return 'xlsx';
    }
    // Convert to string for further detection
    const str = new TextDecoder().decode(bytes);
    return detectFromString(str);
  }

  return detectFromString(input as string);
}

function detectFromString(str: string): DatasetFormat {
  const trimmed = str.trim();

  // Try JSON array
  if (trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // not valid JSON
    }
  }

  // Try JSONL (first line is valid JSON object)
  const firstLine = trimmed.split('\n')[0]?.trim();
  if (firstLine?.startsWith('{')) {
    try {
      JSON.parse(firstLine);
      return 'jsonl';
    } catch {
      // not valid JSONL
    }
  }

  // Default to CSV
  return 'csv';
}
