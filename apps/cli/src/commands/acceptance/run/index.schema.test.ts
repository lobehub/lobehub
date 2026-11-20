import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../../../api/client';
import { attachAcceptanceRunCommands } from '.';

vi.mock('../../../api/client', () => ({ getTrpcClient: vi.fn() }));

describe('offline acceptance report commands', () => {
  let dir: string;
  let printed: string[];
  let exitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.resetAllMocks();
    exitCode = process.exitCode;
    process.exitCode = undefined;
    printed = [];
    vi.spyOn(console, 'log').mockImplementation((line) => printed.push(String(line)));
    // This repository declares a project in `.agents/acceptance/config.json`;
    // run outside it so the dry run does not look that project up.
    vi.spyOn(process, 'cwd').mockReturnValue(tmpdir());
    vi.mocked(getTrpcClient).mockRejectedValue(new Error('No account configured'));
    dir = await mkdtemp(path.join(tmpdir(), 'lh-offline-report-'));
  });

  afterEach(async () => {
    process.exitCode = exitCode;
    vi.restoreAllMocks();
    await rm(dir, { force: true, recursive: true });
  });

  const run = async (...args: string[]) => {
    const program = new Command().exitOverride();
    attachAcceptanceRunCommands(program.command('acceptance'));
    await program.parseAsync(['node', 'lh', 'acceptance', 'run', ...args]);
  };

  const result = () => JSON.parse(printed.at(-1)!);

  it('generates and validates a CLI draft without account access or file mutations', async () => {
    await run('schema', '--example', '--surface', 'cli');
    const example = result();
    expect(example.cases).toEqual([]);
    expect(example.plan[0].surface).toBe('cli');
    const report = JSON.stringify(example);
    await writeFile(path.join(dir, 'result.json'), report);

    await run('validate', dir);

    expect(result()).toMatchObject({ valid: true, draft: true, planItems: 1, cases: 0 });
    expect(getTrpcClient).not.toHaveBeenCalled();
    expect(await readFile(path.join(dir, 'result.json'), 'utf8')).toBe(report);
    expect(process.exitCode).toBeUndefined();
  });

  it('emits parseable diagnostics and exits unsuccessfully for an invalid report', async () => {
    await writeFile(path.join(dir, 'result.json'), '{"title":');

    await run('validate', dir, '--json');

    expect(result()).toMatchObject({ valid: false, errors: [expect.any(Object)] });
    expect(process.exitCode).toBe(1);
    expect(getTrpcClient).not.toHaveBeenCalled();
  });

  it('selects requested fields from schema output without logging prose', async () => {
    await run('schema', '--json', 'type,required');

    expect(Object.keys(result()).sort()).toEqual(['required', 'type']);
    expect(result().type).toBe('object');
    expect(printed).toHaveLength(1);
    expect(getTrpcClient).not.toHaveBeenCalled();
  });

  it('accepts the generated draft through the existing account-aware ingest dry run', async () => {
    await run('schema', '--example');
    await writeFile(path.join(dir, 'result.json'), JSON.stringify(result()));
    const mutate = vi.fn();
    vi.mocked(getTrpcClient).mockResolvedValue({
      acceptance: { ensure: { mutate } },
      user: {
        getUserState: {
          query: vi
            .fn()
            .mockResolvedValue({ settings: { general: { responseLanguage: 'en-US' } } }),
        },
      },
      verify: { createRun: { mutate } },
    } as unknown as Awaited<ReturnType<typeof getTrpcClient>>);

    await run('ingest', dir, '--dry-run', '--json');

    expect(result()).toMatchObject({ dryRun: true, planItems: 1, cases: 0 });
    expect(mutate).not.toHaveBeenCalled();
  });
});
