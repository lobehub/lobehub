import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh message` message management commands.
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

describe('lh message - E2E', () => {
  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list messages in table format', () => {
      const output = run('message list');
      // Either shows table or "No messages found."
      expect(output).toBeTruthy();
    });

    it('should output JSON', () => {
      const list = runJson<any[]>('message list --json id,role');
      expect(Array.isArray(list)).toBe(true);
      if (list.length > 0) {
        expect(list[0]).toHaveProperty('id');
        expect(list[0]).toHaveProperty('role');
      }
    });

    it('should respect limit option', () => {
      const list = runJson<any[]>('message list --json id -L 5');
      expect(list.length).toBeLessThanOrEqual(5);
    });
  });

  // ── search ────────────────────────────────────────────

  describe('search', () => {
    it('should search messages', () => {
      const output = run('message search "hello"');
      expect(typeof output).toBe('string');
    });

    it('should output JSON', () => {
      const list = runJson<any[]>('message search "hello" --json id,role');
      expect(Array.isArray(list)).toBe(true);
    });
  });

  // ── count ─────────────────────────────────────────────

  describe('count', () => {
    it('should show message count', () => {
      const output = run('message count');
      expect(output).toContain('Messages:');
    });

    it('should output JSON', () => {
      const output = run('message count --json');
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('count');
      expect(typeof parsed.count).toBe('number');
    });
  });

  // ── heatmap ───────────────────────────────────────────

  describe('heatmap', () => {
    it('should show heatmap data', () => {
      const output = run('message heatmap');
      expect(output).toBeTruthy();
    });

    it('should accept --json flag without error', () => {
      // Heatmap JSON can be very large; just verify the command doesn't throw
      expect(() => run('message heatmap --json')).not.toThrow();
    });
  });
});
