import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

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
    const root = fs.mkdtempSync(path.join(process.cwd(), '.winsearch-e2e-'));

    beforeEach(() => {
      fs.rmSync(root, { force: true, recursive: true });
      fs.mkdirSync(root, { recursive: true });
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
  },
);
