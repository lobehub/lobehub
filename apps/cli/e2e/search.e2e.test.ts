import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh search` global search command.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 */

const CLI = process.env.LH_CLI_PATH || 'lh';
const TIMEOUT = 30_000;

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    timeout: TIMEOUT,
  }).trim();
}

function runJson<T = any>(args: string): T {
  const output = run(args);
  return JSON.parse(output) as T;
}

describe('lh search - E2E', () => {
  it('should search across types', () => {
    const output = run('search "test"');
    // May show results or "No results found."
    expect(output).toBeTruthy();
  });

  it('should output JSON', () => {
    const result = runJson('search "test" --json');
    expect(result).toBeTruthy();
  });

  it('should filter by type', () => {
    const output = run('search "test" --type agent');
    expect(output).toBeTruthy();
  });

  it('should respect limit option', () => {
    const result = runJson('search "test" --json -L 3');
    expect(result).toBeTruthy();
  });

  it('should error for invalid type', () => {
    expect(() => run('search "test" --type invalidtype')).toThrow();
  });
});
