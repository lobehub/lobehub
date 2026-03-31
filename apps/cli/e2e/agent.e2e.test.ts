import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh agent` agent management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 *
 * These tests create a real agent, verify CRUD operations, then clean up.
 * Note: `agent run` and `agent status` are not tested here as they require
 * active SSE connections and running agents.
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

describe('lh agent - E2E', () => {
  const testTitle = `E2E-Agent-${Date.now()}`;
  const testDescription = 'Created by E2E test';
  let createdId: string;

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list agents in table format', () => {
      const output = run('agent list');
      expect(output).toBeTruthy();
    });

    it('should output JSON', () => {
      const list = runJson<any[]>('agent list --json id,title');
      expect(Array.isArray(list)).toBe(true);
    });

    it('should respect limit option', () => {
      const list = runJson<any[]>('agent list --json id -L 3');
      expect(list.length).toBeLessThanOrEqual(3);
    });
  });

  // ── create ────────────────────────────────────────────

  describe('create', () => {
    it('should create an agent', () => {
      const output = run(`agent create -t "${testTitle}" -d "${testDescription}"`);
      expect(output).toContain('Created agent');

      const match = output.match(/Created agent\s+(\S+)/);
      expect(match).not.toBeNull();
      createdId = match![1];
    });
  });

  // ── view ──────────────────────────────────────────────

  describe('view', () => {
    it('should view agent details', () => {
      const output = run(`agent view ${createdId}`);
      expect(output).toContain(testTitle);
    });

    it('should output JSON', () => {
      const result = runJson<{ title: string }>(`agent view ${createdId} --json title,description`);
      expect(result.title).toBe(testTitle);
    });
  });

  // ── edit ──────────────────────────────────────────────

  describe('edit', () => {
    const updatedTitle = `${testTitle}-Updated`;

    it('should update agent title', () => {
      const output = run(`agent edit ${createdId} -t "${updatedTitle}"`);
      expect(output).toContain('Updated agent');
    });

    it('should reflect updates when viewed', () => {
      const result = runJson<{ title: string }>(`agent view ${createdId} --json title`);
      expect(result.title).toBe(updatedTitle);
    });

    it('should error when no changes specified', () => {
      expect(() => run(`agent edit ${createdId}`)).toThrow();
    });
  });

  // ── duplicate ─────────────────────────────────────────

  describe('duplicate', () => {
    let duplicatedId: string;

    it('should duplicate an agent', () => {
      const output = run(`agent duplicate ${createdId}`);
      expect(output).toContain('Duplicated agent');

      const match = output.match(/→\s+(\S+)/);
      if (match) duplicatedId = match[1];
    });

    it('should clean up duplicate', () => {
      if (duplicatedId) {
        const output = run(`agent delete ${duplicatedId} --yes`);
        expect(output).toContain('Deleted agent');
      }
    });
  });

  // ── delete (cleanup) ──────────────────────────────────

  describe('delete', () => {
    it('should delete the agent', () => {
      const output = run(`agent delete ${createdId} --yes`);
      expect(output).toContain('Deleted agent');
      expect(output).toContain(createdId);
    });
  });
});
