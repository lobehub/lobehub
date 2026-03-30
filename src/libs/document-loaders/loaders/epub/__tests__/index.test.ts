// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

import { EPubLoader } from '../index';

describe('EPubLoader', () => {
  it('should parse epub content into chunks', async () => {
    const content = fs.readFileSync(join(__dirname, `./demo.epub`));
    const fileContent: Uint8Array = new Uint8Array(content);

    const data = await EPubLoader(fileContent);

    expect(data.length).toBeGreaterThan(0);
    for (const chunk of data) {
      expect(chunk.pageContent).toBeTruthy();
      expect(chunk.metadata).toBeDefined();
    }
  });
});
