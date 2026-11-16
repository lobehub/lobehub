import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CREDS_ENV_MERGE_COMMAND,
  mergeCredsEnvListing,
  resolveInjectedEnvVarsByKey,
} from './credsEnv';

describe('CREDS_ENV_MERGE_COMMAND', () => {
  let home: string;

  const credsEnv = () => path.join(home, '.creds', 'env');
  // What Market does on every inject: rewrite the listing with this call's keys only.
  const marketWrites = (lines: string[]) => {
    mkdirSync(path.dirname(credsEnv()), { recursive: true });
    writeFileSync(credsEnv(), `${lines.join('\n')}\n`);
  };
  const runMerge = () =>
    execFileSync('sh', ['-c', CREDS_ENV_MERGE_COMMAND], { env: { ...process.env, HOME: home } });
  const listing = () => readFileSync(credsEnv(), 'utf8').trim().split('\n');

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'creds-env-'));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it('keeps variables from an earlier injection after a later one rewrites the file', () => {
    marketWrites([
      '# LOBEHUB_DATABASE_URL=po******db',
      '# CLOUD_DATABASE_URL=po******db',
      '# MARKET_DATABASE_URL=po******db',
    ]);
    runMerge();

    marketWrites(['# DEEPSEEK_API_KEY=sk******ab']);
    runMerge();

    expect(listing()).toEqual([
      '# LOBEHUB_DATABASE_URL=******',
      '# CLOUD_DATABASE_URL=******',
      '# MARKET_DATABASE_URL=******',
      '# DEEPSEEK_API_KEY=******',
    ]);
  });

  it('keeps one line per variable, the latest one, in first-seen order', () => {
    marketWrites(['# Injected credentials', '# DEEPSEEK_API_KEY=sk******aa', 'export FOO=1']);
    runMerge();

    marketWrites(['# Injected credentials', '# DEEPSEEK_API_KEY=sk******bb']);
    runMerge();

    expect(listing()).toEqual([
      '# Injected credentials',
      '# DEEPSEEK_API_KEY=******',
      'export FOO=1',
    ]);
  });

  it('drops the value fragments Market leaves in masked lines', () => {
    marketWrites(['# DEEPSEEK_API_KEY=sk******ab', '#OPENAI_API_KEY=8f******vZ', 'export FOO=bar']);
    runMerge();

    const content = readFileSync(credsEnv(), 'utf8');
    expect(content).not.toMatch(/sk\*|\*ab|8f\*|\*vZ/);
    expect(listing()).toEqual([
      '# DEEPSEEK_API_KEY=******',
      '# OPENAI_API_KEY=******',
      'export FOO=bar',
    ]);
  });

  it('works when the sandbox has no listing yet', () => {
    runMerge();

    expect(readFileSync(credsEnv(), 'utf8')).toBe('');
  });
});

describe('mergeCredsEnvListing', () => {
  it('runs the merge command in the sandbox', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: {}, success: true });

    await expect(mergeCredsEnvListing({ callTool })).resolves.toBe(true);
    expect(callTool).toHaveBeenCalledWith('runCommand', { command: CREDS_ENV_MERGE_COMMAND });
  });

  it('reports failure without throwing', async () => {
    const callTool = vi.fn().mockResolvedValue({ error: { message: 'x' }, success: false });

    await expect(mergeCredsEnvListing({ callTool })).resolves.toBe(false);
    await expect(
      mergeCredsEnvListing({ callTool: vi.fn().mockRejectedValue(new Error('down')) }),
    ).resolves.toBe(false);
  });
});

describe('resolveInjectedEnvVarsByKey', () => {
  it('attributes every variable to a single injected key without another call', async () => {
    const lookup = vi.fn();

    await expect(
      resolveInjectedEnvVarsByKey(
        ['deepseek', 'missing'],
        { credentials: { env: { DEEPSEEK_API_KEY: 'x' } }, notFound: ['missing'] },
        lookup,
      ),
    ).resolves.toEqual({ deepseek: ['DEEPSEEK_API_KEY'] });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('looks each key up when one call injected several', async () => {
    const lookup = vi.fn(async (key: string) => ({
      credentials: { env: key === 'a' ? { A_1: 'x', A_2: 'x' } : { B_1: 'x' } },
    }));

    await expect(
      resolveInjectedEnvVarsByKey(
        ['a', 'b'],
        { credentials: { env: { A_1: 'x', A_2: 'x', B_1: 'x' } } },
        lookup,
      ),
    ).resolves.toEqual({ a: ['A_1', 'A_2'], b: ['B_1'] });
  });

  it('gives up on attribution when a lookup fails', async () => {
    await expect(
      resolveInjectedEnvVarsByKey(
        ['a', 'b'],
        { credentials: { env: { A_1: 'x', B_1: 'x' } } },
        vi.fn().mockRejectedValue(new Error('market down')),
      ),
    ).resolves.toBeUndefined();
  });
});
