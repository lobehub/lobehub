import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolDetector } from '../../toolDetector';

const execaMock = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: execaMock }));

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const { WindowsSearchServiceImpl } = await import('../impl/windows');

/**
 * The PowerShell backend builds one `-Command` string, so `onlyIn` and `keywords` are
 * parsed as PowerShell source rather than passed as argv. Two Windows path shapes broke
 * that, in different ways:
 *
 * - `-Path` reads its value as a wildcard expression, so a directory named `[v2] builds`
 *   matched nothing. PowerShell exits 0 with empty stdout, so the
 *   `exitCode !== 0 && !stdout.trim()` guard never fired and the caller got `[]`.
 * - A `'` in either value ended the quoted literal early, so `C:\Users\o'brien` failed
 *   the whole call with "The string is missing the terminator" (exit 1). That one takes
 *   the fast-glob fallback and pins `currentTool` there for the session.
 *
 * `windowsPowerShellReal.test.ts` covers the same shapes against the real engine.
 */
const powershellDetector: ToolDetector = { getBestTool: vi.fn().mockResolvedValue('powershell') };

/** The `-Command` string the impl handed to PowerShell for the call under test. */
const commandArg = (): string => {
  const call = execaMock.mock.calls.find(([cmd]) => cmd === 'powershell');
  if (!call) throw new Error('powershell was never spawned');
  const args: string[] = call[1];
  return args.at(-1)!;
};

const usePowerShell = (stdout = '') => {
  execaMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'where') return { exitCode: 0, stderr: '', stdout: 'C:\\bin\\fd.exe' };
    return { exitCode: 0, stderr: '', stdout };
  });
};

describe('WindowsSearchServiceImpl PowerShell command shape', () => {
  beforeEach(() => {
    execaMock.mockReset();
  });

  it('uses -LiteralPath so a bracket in the directory is not read as a wildcard', async () => {
    const dir = path.join(os.tmpdir(), '[v2] builds');
    usePowerShell();

    await new WindowsSearchServiceImpl(powershellDetector).search({
      keywords: 'alpha',
      onlyIn: dir,
    });

    const command = commandArg();
    expect(command).toContain('-LiteralPath');
    expect(command).not.toMatch(/(?<!Literal)-Path\s/);
  });

  it('doubles a single quote in the search directory instead of ending the literal', async () => {
    const dir = path.join(os.tmpdir(), "o'brien");
    usePowerShell();

    await new WindowsSearchServiceImpl(powershellDetector).search({
      keywords: 'alpha',
      onlyIn: dir,
    });

    // `C:\...\o'brien` must reach PowerShell as `C:\...\o''brien`.
    expect(commandArg()).toContain("o''brien");
    expect(commandArg()).not.toContain("'o'brien'");
  });

  it('doubles a single quote in the keyword filter', async () => {
    usePowerShell();

    await new WindowsSearchServiceImpl(powershellDetector).search({
      keywords: "o'brien",
      onlyIn: 'C:\\projects',
    });

    expect(commandArg()).toContain("-Filter '*o''brien*'");
  });

  it('leaves a quote-free directory and keyword unchanged', async () => {
    usePowerShell();

    await new WindowsSearchServiceImpl(powershellDetector).search({
      keywords: 'alpha',
      onlyIn: 'C:\\projects\\app',
    });

    const command = commandArg();
    expect(command).toContain("-LiteralPath 'C:\\projects\\app'");
    expect(command).toContain("-Filter '*alpha*'");
  });

  it('sets the console output encoding before searching', async () => {
    usePowerShell();

    await new WindowsSearchServiceImpl(powershellDetector).search({
      keywords: 'alpha',
      onlyIn: 'C:\\projects\\app',
    });

    const command = commandArg();
    expect(command).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8');
    // It has to run before the search, or the mojibake is already on the wire.
    expect(command.indexOf('OutputEncoding')).toBeLessThan(command.indexOf('Get-ChildItem'));
  });
});
