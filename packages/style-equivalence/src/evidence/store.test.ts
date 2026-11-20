import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRunDir } from './store';

describe('createRunDir', () => {
  it('gives runs started at the same moment their own directories', async () => {
    const records = await mkdtemp(path.join(tmpdir(), 'style-eq-records-'));
    try {
      const runs = await Promise.all(
        Array.from({ length: 4 }, () => createRunDir(records, 'a'.repeat(40), 'b'.repeat(40))),
      );
      expect(new Set(runs.map((run) => run.runDir)).size).toBe(4);
    } finally {
      await rm(records, { force: true, recursive: true });
    }
  });
});
