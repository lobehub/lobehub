// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

import { CsVLoader } from '../index';

describe('CSVLoader', () => {
  it('should parse CSV rows into documents', async () => {
    const content = fs.readFileSync(join(__dirname, `./demo.csv`), 'utf8');
    const fileBlob = new Blob([Buffer.from(content)]);

    const data = await CsVLoader(fileBlob);

    expect(data.length).toBe(32);
    // Check first row structure
    expect(data[0].metadata.line).toBe(1);
    expect(data[0].metadata.source).toBe('blob');
    expect(data[0].pageContent).toContain('Hair:');
    expect(data[0].pageContent).toContain('Eye:');
  });
});
