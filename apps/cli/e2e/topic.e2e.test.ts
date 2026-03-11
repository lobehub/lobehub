import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh topic` conversation topic management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 *
 * These tests create a real topic, verify CRUD operations, then clean up.
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

describe('lh topic - E2E', () => {
  const testTitle = `E2E-Topic-${Date.now()}`;
  let createdId: string;

  // ── create ────────────────────────────────────────────

  describe('create', () => {
    it('should create a topic', () => {
      const output = run(`topic create -t "${testTitle}"`);
      expect(output).toContain('Created topic');

      const match = output.match(/Created topic\s+(\S+)/);
      expect(match).not.toBeNull();
      createdId = match![1];
    });
  });

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list topics in table format', () => {
      const output = run('topic list');
      // Should show table headers or "No topics"
      expect(output).toBeTruthy();
    });

    it('should output JSON', () => {
      const list = runJson<any[]>('topic list --json id,title');
      expect(Array.isArray(list)).toBe(true);
    });
  });

  // ── search ────────────────────────────────────────────

  describe('search', () => {
    it('should search topics', () => {
      const output = run(`topic search "${testTitle}"`);
      expect(typeof output).toBe('string');
    });

    it('should output JSON', () => {
      const list = runJson<any[]>(`topic search "${testTitle}" --json id,title`);
      expect(Array.isArray(list)).toBe(true);
    });
  });

  // ── edit ──────────────────────────────────────────────

  describe('edit', () => {
    const updatedTitle = `${testTitle}-Updated`;

    it('should update topic title', () => {
      const output = run(`topic edit ${createdId} -t "${updatedTitle}"`);
      expect(output).toContain('Updated topic');
    });

    it('should error when no changes specified', () => {
      expect(() => run(`topic edit ${createdId}`)).toThrow();
    });
  });

  // ── recent ────────────────────────────────────────────

  describe('recent', () => {
    it('should list recent topics', () => {
      const output = run('topic recent');
      expect(output).toBeTruthy();
    });

    it('should output JSON', () => {
      const list = runJson<any[]>('topic recent --json id,title');
      expect(Array.isArray(list)).toBe(true);
    });
  });

  // ── delete (cleanup) ──────────────────────────────────

  describe('delete', () => {
    it('should delete the topic', () => {
      const output = run(`topic delete ${createdId} --yes`);
      expect(output).toContain('Deleted');
      expect(output).toContain('1 topic(s)');
    });
  });
});
