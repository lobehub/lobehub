// @vitest-environment node
import * as fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, vi } from 'vitest';

import * as splitter from '../../../splitter';
import { EPubLoader } from '../index';

describe('EPubLoader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse epub content into chunks', async () => {
    const content = fs.readFileSync(path.join(__dirname, `./demo.epub`));
    const fileContent: Uint8Array = new Uint8Array(content);

    const data = await EPubLoader(fileContent);

    expect(data.length).toBeGreaterThan(0);
    for (const chunk of data) {
      expect(chunk.pageContent).toBeTruthy();
      expect(chunk.metadata).toBeDefined();
      expect(chunk.metadata.source).toBe('blob');
    }
  });

  it('should reject over-budget EPUBs instead of silently skipping the chapter', async () => {
    const content = fs.readFileSync(path.join(__dirname, `./demo.epub`));
    const fileContent: Uint8Array = new Uint8Array(content);
    vi.spyOn(splitter, 'splitText').mockImplementationOnce(() => {
      throw new splitter.DocumentChunkLimitError(1);
    });

    await expect(EPubLoader(fileContent)).rejects.toThrow(
      'Document chunk count exceeds maximum allowed limit of 1',
    );
  });
});
