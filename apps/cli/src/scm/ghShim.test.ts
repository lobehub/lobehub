import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureGhShim } from './ghShim';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();
  return { ...actual, rename: vi.fn(actual.rename), writeFile: vi.fn(actual.writeFile) };
});

let root: string;

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
  vi.clearAllMocks();
});

describe('ensureGhShim', () => {
  it('replaces the shim in one step so a concurrent gh never runs a half-written file', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'lh-shim-'));
    const shimPath = await ensureGhShim(path.join(root, 'shim'), '/bin/helper');

    const written = vi.mocked(fsPromises.writeFile).mock.calls.map(([target]) => String(target));
    expect(written).not.toContain(shimPath);
    expect(fsPromises.rename).toHaveBeenCalledWith(written[0], shimPath);
    expect(readFileSync(shimPath, 'utf8')).toContain('/bin/helper get');
  });
});
