export type DatasetFormat = 'auto' | 'csv' | 'json' | 'jsonl' | 'xlsx';

export interface ParseOptions {
  csvDelimiter?: string;
  format?: DatasetFormat;
  headerRow?: number;
  preview?: number;
  sheet?: number | string;
}

export interface ParseResult {
  format: DatasetFormat;
  headers: string[];
  metadata?: {
    sheetName?: string;
  };
  rows: Record<string, any>[];
  totalCount: number;
}
