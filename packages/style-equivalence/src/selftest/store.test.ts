import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { saveSelfTest, SELF_TEST_FILE } from './store';

let dir = '';
afterEach(() => rm(dir, { force: true, recursive: true }));

describe('saveSelfTest', () => {
  it('stores the report with when it ran and the verifier version', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'style-eq-selftest-'));
    await saveSelfTest(dir, { css: [], passed: true, source: [] }, '2026-11-04T00:00:00.000Z');
    expect(JSON.parse(await readFile(path.join(dir, SELF_TEST_FILE), 'utf8'))).toEqual({
      css: [],
      passed: true,
      ranAt: '2026-11-04T00:00:00.000Z',
      source: [],
      verifierVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    });
  });
});
