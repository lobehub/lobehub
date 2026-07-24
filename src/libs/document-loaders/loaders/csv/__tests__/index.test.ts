// @vitest-environment node
import * as fs from 'node:fs';
import path from 'node:path';

import { expect } from 'vitest';

import { MAX_CSV_ROWS } from '../../config';
import { CsVLoader } from '../index';

describe('CSVLoader', () => {
  it('should parse CSV rows into documents', async () => {
    const content = fs.readFileSync(path.join(__dirname, `./demo.csv`), 'utf8');
    const fileBlob = new Blob([Buffer.from(content)]);

    const data = await CsVLoader(fileBlob);

    expect(data.length).toBe(32);
    // Check first row structure
    expect(data[0].metadata.line).toBe(1);
    expect(data[0].metadata.source).toBe('blob');
    expect(data[0].pageContent).toContain('Hair:');
    expect(data[0].pageContent).toContain('Eye:');
  });

  it('should reject CSV files with too many rows', async () => {
    const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) => `${index}`);
    const fileBlob = new Blob([`id\n${rows.join('\n')}`]);

    await expect(CsVLoader(fileBlob)).rejects.toThrow(
      'CSV row count exceeds maximum allowed limit',
    );
  });
});
