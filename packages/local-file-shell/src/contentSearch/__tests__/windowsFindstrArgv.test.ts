import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const execaMock = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: execaMock }));
const { WindowsContentSearchImpl } = await import('../impl/windows');

/**
 * Windows machines without `rg` used to fall to a findstr engine that ran
 * `cmd /c findstr /R "<pattern>" *.*`. libuv escapes the embedded quotes to
 * `\"`, cmd.exe strips only the outer pair, and findstr then searched for the
 * literal `"<pattern>"` — so almost every call answered "Found 0 matches".
 * findstr also has no `|`, `\d`, UTF-8 CJK or glob support, so the fix drops it:
 * without `rg`, Windows searches with the Node engine.
 */
describe('Windows grepContent without rg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-win-repro-'));
  const file = path.join(dir, 'colour-grid.php');
  fs.writeFileSync(file, '$img = mvx_image($id);\n// 点动 a\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'image of a cat\n');

  beforeEach(() => {
    execaMock.mockReset();
    execaMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'where') throw new Error('INFO: Could not find files for the given pattern(s).');
      // Any other spawn (the old findstr path) answers "no output", like the
      // quoted findstr did on real Windows.
      return { exitCode: 1, stderr: '', stdout: '' };
    });
  });

  const spawnedCmd = () => execaMock.mock.calls.some(([cmd]) => cmd === 'cmd');

  it('finds a plain pattern instead of the quoted literal', async () => {
    const result = await new WindowsContentSearchImpl().grep({
      output_mode: 'count',
      pattern: 'a',
      scope: dir,
    });

    expect(spawnedCmd()).toBe(false);
    expect(result.success).toBe(true);
    expect(result.total_matches).toBeGreaterThan(0);
  });

  it('honours glob instead of searching *.*', async () => {
    const result = await new WindowsContentSearchImpl().grep({
      glob: '*.php',
      output_mode: 'files_with_matches',
      pattern: 'image',
      scope: dir,
    });

    expect(result.matches.map((m) => path.basename(m))).toEqual(['colour-grid.php']);
  });

  it('supports alternation and CJK patterns', async () => {
    const result = await new WindowsContentSearchImpl().grep({
      output_mode: 'content',
      pattern: 'nothing-here|点动',
      scope: dir,
    });

    expect(result.total_matches).toBe(1);
    expect(result.matches[0]).toContain('点动');
  });

  it('searches a file scope', async () => {
    const result = await new WindowsContentSearchImpl().grep({
      output_mode: 'content',
      path: file,
      pattern: 'image',
    });

    expect(result.total_matches).toBe(1);
    expect(result.matches[0]).toContain('mvx_image');
  });

  it('reports an invalid pattern instead of rejecting', async () => {
    const result = await new WindowsContentSearchImpl().grep({
      output_mode: 'content',
      pattern: '(',
      scope: dir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid regular expression');
  });
});

describe('Windows grepContent with rg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-win-rg-'));
  const file = path.join(dir, 'colour-grid.php');
  fs.writeFileSync(file, '$img = mvx_image($id);\n');

  const rgCall = () => execaMock.mock.calls.find(([cmd]) => cmd === 'rg')!;

  beforeEach(() => {
    execaMock.mockReset();
    execaMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'where') return { exitCode: 0, stderr: '', stdout: 'C:\\bin\\rg.exe' };
      return { exitCode: 0, stderr: '', stdout: './colour-grid.php:$img = mvx_image($id);' };
    });
  });

  it('passes pattern and glob to rg as separate, unquoted argv', async () => {
    await new WindowsContentSearchImpl().grep({
      glob: '*.php',
      output_mode: 'content',
      pattern: 'image',
      scope: dir,
    });

    const [, args] = rgCall();
    expect(args).toContain('image');
    expect(args.join(' ')).toContain('-g *.php');
  });

  it('searches a file scope from its directory, not with cwd=<file>', async () => {
    await new WindowsContentSearchImpl().grep({
      output_mode: 'content',
      path: file,
      pattern: 'image',
    });

    const [, args, options] = rgCall();
    expect(fs.statSync(options.cwd).isDirectory()).toBe(true);
    expect(args.at(-1)).toBe('./colour-grid.php');
  });

  it('reports an rg failure instead of zero matches', async () => {
    execaMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'where') return { exitCode: 0, stderr: '', stdout: 'C:\\bin\\rg.exe' };
      return { exitCode: 2, stderr: 'regex parse error: unclosed group', stdout: '' };
    });

    const result = await new WindowsContentSearchImpl().grep({
      output_mode: 'content',
      pattern: '(',
      scope: dir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('regex parse error');
  });

  it('falls back to a real search when the rg binary fails to spawn', async () => {
    execaMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'where') return { exitCode: 0, stderr: '', stdout: 'C:\\bin\\rg.exe' };
      // execa with `reject: false` resolves a spawn failure: no exit code.
      return { code: 'ENOENT', exitCode: undefined, failed: true, stderr: '', stdout: '' };
    });

    const result = await new WindowsContentSearchImpl({
      getBestTool: async () => 'rg',
    }).grep({ output_mode: 'content', pattern: 'image', scope: dir });

    expect(result.engine).toBe('nodejs');
    expect(result.total_matches).toBe(1);
  });
});
