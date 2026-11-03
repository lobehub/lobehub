import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Desktop TRPC Route', () => {
  it('should have expected trpc route directories', () => {
    const routeDirs = ['async', 'lambda', 'mobile', 'tools'];

    for (const dir of routeDirs) {
      const routePath = path.join(__dirname, dir);
      expect(existsSync(routePath)).toBe(true);
    }
  });
});
