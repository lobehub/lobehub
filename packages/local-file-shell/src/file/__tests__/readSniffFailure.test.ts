import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type * as fileLoadersModule from '@lobechat/file-loaders';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readLocalFile } from '../read';

const { sniffBinaryFile } = vi.hoisted(() => ({ sniffBinaryFile: vi.fn() }));

vi.mock('@lobechat/file-loaders', async (importOriginal) => ({
  ...(await importOriginal<typeof fileLoadersModule>()),
  sniffBinaryFile,
}));

describe('readLocalFile when the binary sniff throws', () => {
  const tmpDir = path.join(os.tmpdir(), 'local-file-shell-sniff-test-' + process.pid);
  const filePath = path.join(tmpDir, 'notes');

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(filePath, 'hello\nworld\n');
  });

  afterEach(() => {
    sniffBinaryFile.mockReset();
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('reports a defect in the sniffer instead of reading the file unchecked', async () => {
    // What the CLI bundle hit in #19934: the helper was an uninitialized binding.
    sniffBinaryFile.mockRejectedValue(new TypeError('sniffBinaryFile is not a function'));

    const result = await readLocalFile({ path: filePath });

    expect(result.content).toBe(
      'Error: Failed to check whether the file is binary: sniffBinaryFile is not a function',
    );
    expect(result.totalCharCount).toBe(0);
  });

  it('falls through to loading the file when the sniff hits an IO error', async () => {
    sniffBinaryFile.mockRejectedValue(
      Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' }),
    );

    const result = await readLocalFile({ path: filePath });

    expect(result.content).toContain('hello');
    expect(result.totalCharCount).toBe('hello\nworld\n'.length);
  });
});
