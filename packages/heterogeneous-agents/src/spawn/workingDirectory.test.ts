import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as NodeOs from 'node:os';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertSpawnableWorkingDirectory,
  describeUnusableWorkingDirectory,
  isSpawnableDirectory,
  resolveHeteroSpawnCwd,
} from './workingDirectory';

// `homedir` / `tmpdir` are mocked so the fallback chain can be driven without
// depending on the machine's real home and temp layout.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOs>();
  return {
    ...actual,
    homedir: vi.fn(() => actual.homedir()),
    tmpdir: vi.fn(() => actual.tmpdir()),
  };
});

const realOs = await vi.importActual<typeof NodeOs>('node:os');
const realHomedir = realOs.homedir();
const realTmpdir = realOs.tmpdir();

const workDir = mkdtempSync(path.join(realTmpdir, 'hetero-workdir-'));
const filePath = path.join(workDir, 'file.txt');
writeFileSync(filePath, 'x');
const missingDir = path.join(workDir, 'gone');

afterAll(() => {
  rmSync(workDir, { force: true, recursive: true });
});

beforeEach(() => {
  vi.mocked(homedir).mockReturnValue(realHomedir);
  vi.mocked(tmpdir).mockReturnValue(realTmpdir);
});

describe('isSpawnableDirectory', () => {
  it('accepts a directory and rejects a missing path or a regular file', () => {
    expect(isSpawnableDirectory(workDir)).toBe(true);
    expect(isSpawnableDirectory(missingDir)).toBe(false);
    expect(isSpawnableDirectory(filePath)).toBe(false);
  });
});

describe('describeUnusableWorkingDirectory', () => {
  it('distinguishes a missing path from a path that is not a directory', () => {
    expect(describeUnusableWorkingDirectory(missingDir)).toBe(
      `Working directory does not exist: ${missingDir}`,
    );
    expect(describeUnusableWorkingDirectory(filePath)).toBe(
      `Working directory is not a directory: ${filePath}`,
    );
  });
});

describe('assertSpawnableWorkingDirectory', () => {
  it('passes for a directory', () => {
    expect(() => assertSpawnableWorkingDirectory(workDir)).not.toThrow();
  });

  it('throws the structured working-directory error for an unusable path', () => {
    expect(() => assertSpawnableWorkingDirectory(filePath)).toThrow(
      `Working directory is not a directory: ${filePath}`,
    );
    expect(() => assertSpawnableWorkingDirectory(missingDir)).toThrow(
      expect.objectContaining({
        code: 'HETERO_WORKING_DIRECTORY_NOT_FOUND',
        workingDirectory: missingDir,
      }),
    );
  });
});

describe('resolveHeteroSpawnCwd', () => {
  it('keeps the configured working directory when it is usable', () => {
    expect(resolveHeteroSpawnCwd(workDir)).toBe(workDir);
  });

  it('falls back to home when the working directory is gone', () => {
    expect(resolveHeteroSpawnCwd(missingDir)).toBe(realHomedir);
  });

  it('falls back to temp when home is unavailable too', () => {
    vi.mocked(homedir).mockReturnValue(path.join(missingDir, 'home'));

    expect(resolveHeteroSpawnCwd(missingDir)).toBe(realTmpdir);
  });

  it('returns undefined so the caller inherits its own cwd when nothing is usable', () => {
    vi.mocked(homedir).mockReturnValue(path.join(missingDir, 'home'));
    vi.mocked(tmpdir).mockReturnValue(path.join(missingDir, 'tmp'));

    expect(resolveHeteroSpawnCwd(missingDir)).toBeUndefined();
  });
});
