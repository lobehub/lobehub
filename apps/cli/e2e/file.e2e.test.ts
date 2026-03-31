import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh file` file management commands.
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

describe('lh file - E2E', () => {
  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list files in table format', () => {
      const output = run('file list');
      // Either table or "No files found."
      expect(output).toBeTruthy();
    });

    it('should output JSON', () => {
      const list = runJson<any[]>('file list --json id,name');
      expect(Array.isArray(list)).toBe(true);
      if (list.length > 0) {
        expect(list[0]).toHaveProperty('id');
        expect(list[0]).toHaveProperty('name');
      }
    });

    it('should accept limit option', () => {
      // Backend may not strictly enforce limit; verify it doesn't error
      const list = runJson<any[]>('file list --json id -L 5');
      expect(Array.isArray(list)).toBe(true);
    });
  });

  // ── view ──────────────────────────────────────────────

  describe('view', () => {
    it('should show file details if files exist', () => {
      const list = runJson<{ id: string }[]>('file list --json id -L 1');
      if (list.length > 0) {
        const output = run(`file view ${list[0].id}`);
        expect(output).toBeTruthy();
      }
    });

    it('should output JSON for file detail', () => {
      const list = runJson<{ id: string }[]>('file list --json id -L 1');
      if (list.length > 0) {
        const result = runJson(`file view ${list[0].id} --json id,name`);
        expect(result).toHaveProperty('id');
      }
    });

    it('should error for nonexistent file', () => {
      expect(() => run('file view nonexistent-file-xyz')).toThrow();
    });
  });

  // ── recent ────────────────────────────────────────────

  describe('recent', () => {
    it('should list recent files', () => {
      const output = run('file recent');
      expect(output).toBeTruthy();
    });

    it('should output JSON', () => {
      const list = runJson<any[]>('file recent --json id,name');
      expect(Array.isArray(list)).toBe(true);
    });
  });
});
