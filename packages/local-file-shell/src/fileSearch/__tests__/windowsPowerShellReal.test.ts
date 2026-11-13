import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { ToolDetector } from '../../toolDetector';
import { WindowsSearchServiceImpl } from '../impl/windows';

/**
 * End-to-end guard against the real engine: real `execa`, real PowerShell, no mocks.
 *
 * These are the Windows path shapes behind the reported "searchFiles returns zero
 * results" bug:
 *
 * - `-Path` evaluates its value as a wildcard expression, so a directory named
 *   `[v2] builds` matched nothing. PowerShell still exits 0 with empty output, so the
 *   `exitCode !== 0 && !stdout.trim()` fallback never fired and the caller got `[]` —
 *   a wrong "no files" answer instead of a failure.
 * - A `'` in the directory ends the interpolated string literal. PowerShell exits 1,
 *   so the call degrades to fast-glob and pins `currentTool` there for the session.
 *
 * Asserting on `engine` is what makes these regression tests: before the fix the
 * bracket case answered `[]` and the quote case answered from `fast-glob`, so the
 * "still finds the file" assertions alone would have passed.
 */
const powershellDetector: ToolDetector = { getBestTool: async () => 'powershell' };

describe.skipIf(process.platform !== 'win32')(
  'WindowsSearchServiceImpl against real PowerShell',
  () => {
    // Not under os.tmpdir(): the impl excludes **/AppData/Local/Temp/** on Windows.
    // Under the package directory, so it is cleaned up with the rest of the workspace.
    const root = path.join(process.cwd(), `.winsearch-e2e-${process.pid}`);

    beforeEach(() => {
      fs.rmSync(root, { force: true, recursive: true });
      fs.mkdirSync(root, { recursive: true });
    });

    afterAll(() => {
      fs.rmSync(root, { force: true, recursive: true });
    });

    const search = (onlyIn: string, keywords = 'alpha') =>
      new WindowsSearchServiceImpl(powershellDetector).search({ keywords, onlyIn });

    it('finds files under a bracket-named directory without falling back', async () => {
      const dir = path.join(root, '[v2] builds');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'alpha.txt'), 'x');

      const results = await search(dir);

      expect(results.map((r) => r.name)).toEqual(['alpha.txt']);
      expect(results[0].engine).toBe('powershell');
    });

    it('finds files under a directory whose name contains a single quote', async () => {
      const dir = path.join(root, "o'brien");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'alpha.txt'), 'x');

      const results = await search(dir);

      expect(results.map((r) => r.name)).toEqual(['alpha.txt']);
      // Before the fix this came from fast-glob after a PowerShell parse error.
      expect(results[0].engine).toBe('powershell');
    });

    it('finds a file whose name contains a single quote', async () => {
      fs.writeFileSync(path.join(root, "alpha-o'brien.txt"), 'x');

      const results = await search(root, "alpha-o'brien");

      expect(results.map((r) => r.name)).toEqual(["alpha-o'brien.txt"]);
    });

    // Guard against over-escaping: `-Filter` already matches a bracket literally, so
    // escaping it would turn this into a miss.
    it('finds a file whose name contains a bracket', async () => {
      fs.writeFileSync(path.join(root, 'alpha[1].txt'), 'x');

      const results = await search(root, 'alpha[1]');

      expect(results.map((r) => r.name)).toEqual(['alpha[1].txt']);
    });

    /*
     * The reported "zero results on an ordinary directory" symptom. Windows PowerShell
     * writes stdout in the system ANSI code page, so a non-ASCII name reaches Node as
     * mojibake; `stat()` throws for each entry and `processFilePaths` swallows it. The
     * caller gets `[]` even though the file is right there.
     *
     * The keyword is plain ASCII so this exercises the output side rather than the
     * filter; the next test covers a non-ASCII keyword.
     */
    it.each([
      ['Chinese', 'report-季度.txt'],
      ['Japanese', 'report-日本語.md'],
      ['accented Latin', 'report-Ünïcödé.txt'],
      ['emoji', 'report-😀.txt'],
    ])('finds a file with a non-ASCII %s name', async (_label, name) => {
      fs.writeFileSync(path.join(root, name), 'x');

      const results = await search(root, 'report');

      expect(results.map((r) => r.name)).toEqual([name]);
    });

    it('finds a non-ASCII name when the keyword itself is non-ASCII', async () => {
      fs.writeFileSync(path.join(root, '季度报告.txt'), 'x');

      const results = await search(root, '季度报告');

      expect(results.map((r) => r.name)).toEqual(['季度报告.txt']);
    });

    it('returns a path that can be stat()ed, not mojibake', async () => {
      fs.writeFileSync(path.join(root, '季度报告.txt'), 'x');

      const results = await search(root, '季度报告');

      // `processFilePaths` drops any entry whose stat() fails, so a non-empty result
      // already implies this — assert it directly so the reason stays visible.
      expect(results).toHaveLength(1);
      expect(fs.existsSync(results[0].path)).toBe(true);
    });
  },
);
