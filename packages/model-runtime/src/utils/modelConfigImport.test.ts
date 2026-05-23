import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const utilsDir = path.dirname(fileURLToPath(import.meta.url));

describe('model config imports', () => {
  it('keeps runtime model-config imports statically analyzable for browser bundlers', async () => {
    const sources = await Promise.all(
      ['getModelPricing.ts', 'getFallbackModelProperty.ts', 'modelParse.ts'].map((file) =>
        readFile(path.resolve(utilsDir, file), 'utf8'),
      ),
    );

    for (const source of sources) {
      expect(source).not.toContain('@vite-ignore');
      expect(source).not.toContain('BUSINESS_MODEL_CONFIG_MODULE');
    }
  });
});
