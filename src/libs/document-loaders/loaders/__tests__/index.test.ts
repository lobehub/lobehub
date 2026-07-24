// @vitest-environment node
import { expect } from 'vitest';

import { MAX_DOCUMENT_INPUT_BYTES } from '../config';
import { ChunkingLoader } from '../index';

describe('ChunkingLoader', () => {
  it('rejects oversized content before copying or decoding it', async () => {
    const loader = new ChunkingLoader();
    const oversized = { byteLength: MAX_DOCUMENT_INPUT_BYTES + 1 } as Uint8Array;

    await expect(loader.partitionContent('oversized.md', oversized)).rejects.toThrow(
      'Document input size exceeds maximum allowed limit',
    );
  });
});
