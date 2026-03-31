import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh plugin` plugin management commands.
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

describe('lh plugin - E2E', () => {
  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list plugins or show empty message', () => {
      const output = run('plugin list');
      expect(output).toBeTruthy();
    });

    it('should output JSON', () => {
      const list = runJson<any[]>('plugin list --json');
      expect(Array.isArray(list)).toBe(true);
    });

    it('should output JSON with field filtering', () => {
      const list = runJson<any[]>('plugin list --json id,identifier');
      expect(Array.isArray(list)).toBe(true);
      if (list.length > 0) {
        expect(list[0]).toHaveProperty('id');
        expect(list[0]).toHaveProperty('identifier');
      }
    });
  });

  // ── install / update / uninstall ──────────────────────
  // Note: Full CRUD requires a valid manifest JSON which is complex.
  // We test error handling for invalid inputs instead.

  describe('install', () => {
    it('should reject invalid manifest JSON', () => {
      expect(() => run('plugin install -i "test-plugin" --manifest "not-json"')).toThrow();
    });
  });

  describe('update', () => {
    it('should error when no changes specified', () => {
      expect(() => run('plugin update nonexistent-id')).toThrow();
    });

    it('should reject invalid settings JSON', () => {
      expect(() => run('plugin update some-id --settings "not-json"')).toThrow();
    });
  });
});
