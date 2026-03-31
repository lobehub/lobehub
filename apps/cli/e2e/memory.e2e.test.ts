import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh memory` user memory management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 *
 * These tests create real identity memories, verify CRUD operations, then clean up.
 */

const CLI = process.env.LH_CLI_PATH || 'lh';
const TIMEOUT = 60_000;

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

describe(
  'lh memory - E2E',
  () => {
    const testDesc = `E2E-Memory-${Date.now()}`;
    let createdIdentityId: string;

    // ── create ────────────────────────────────────────────

    describe('create', () => {
      it('should create an identity memory with all options', () => {
        const output = run(
          `memory create --type personal --role developer --relationship self -d "${testDesc}" --labels e2e test`,
        );
        expect(output).toContain('Created identity memory');

        // Extract both IDs: "Created identity memory mem_xxx (identity: mem_yyy)"
        const memMatch = output.match(/memory\s+(mem_\w+)/);
        const idMatch = output.match(/identity:\s+(mem_\w+)/);
        expect(memMatch).not.toBeNull();
        expect(idMatch).not.toBeNull();
        createdIdentityId = idMatch![1];
      });

      it('should appear in the identity list', () => {
        const list = runJson<any[]>('memory list identity --json id,description');
        const found = list.find((m) => m.id === createdIdentityId);
        expect(found).toBeDefined();
        expect(found.description).toBe(testDesc);
      });
    });

    // ── list ──────────────────────────────────────────────

    describe('list', () => {
      it('should list all memory categories without error', () => {
        expect(() => run('memory list')).not.toThrow();
      });

      it('should list a specific category in table format', () => {
        const output = run('memory list identity');
        expect(output).toContain('Identity');
        expect(output).toContain('ID');
      });

      it('should output JSON for all categories', () => {
        const result = runJson<Record<string, any[]>>('memory list --json');
        expect(typeof result).toBe('object');
        expect(result).toHaveProperty('identity');
        expect(result).toHaveProperty('activity');
        expect(result).toHaveProperty('context');
        expect(result).toHaveProperty('experience');
        expect(result).toHaveProperty('preference');
      });

      it('should output JSON array for specific category', () => {
        const result = runJson<any[]>('memory list identity --json');
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      });

      it('should support JSON field filtering', () => {
        const result = runJson<any[]>('memory list identity --json id,description');
        expect(Array.isArray(result)).toBe(true);
        if (result.length > 0) {
          expect(result[0]).toHaveProperty('id');
          expect(result[0]).toHaveProperty('description');
        }
      });

      it('should error for invalid category', () => {
        expect(() => run('memory list invalidcategory')).toThrow();
      });
    });

    // ── edit ──────────────────────────────────────────────

    describe('edit', () => {
      const updatedDesc = `${testDesc}-Updated`;

      it('should update identity memory description', () => {
        const output = run(`memory edit identity ${createdIdentityId} -d "${updatedDesc}"`);
        expect(output).toContain('Updated identity memory');
        expect(output).toContain(createdIdentityId);
      });

      it('should reflect the update in list', () => {
        const list = runJson<any[]>('memory list identity --json id,description');
        const found = list.find((m) => m.id === createdIdentityId);
        expect(found).toBeDefined();
        expect(found.description).toBe(updatedDesc);
      });

      it('should error on invalid category', () => {
        expect(() => run(`memory edit invalidcat ${createdIdentityId} -d "test"`)).toThrow();
      });
    });

    // ── persona ───────────────────────────────────────────

    describe('persona', () => {
      it('should show persona summary or empty message', () => {
        const output = run('memory persona');
        expect(output).toBeTruthy();
        expect(output.includes('User Persona') || output.includes('No persona data')).toBe(true);
      });

      it('should output JSON with --json flag', () => {
        const output = run('memory persona --json');
        expect(() => JSON.parse(output)).not.toThrow();
      });
    });

    // ── extract & extract-status ────────────────────────────
    // NOTE: `memory extract` requires backend extraction service which returns 500
    // in dev environments. These commands are tested only in production E2E runs.
    // `memory extract-status` is a read-only check that works without triggering extraction.

    describe('extract-status', () => {
      it('should check extraction task status without error', () => {
        // extract-status is read-only; it returns latest task or empty
        expect(() => run('memory extract-status')).not.toThrow();
      });
    });

    // ── delete (cleanup) ──────────────────────────────────

    describe('delete', () => {
      it('should delete the identity memory', () => {
        const output = run(`memory delete identity ${createdIdentityId} --yes`);
        expect(output).toContain('Deleted identity memory');
        expect(output).toContain(createdIdentityId);
      });

      it('should no longer appear in the list', () => {
        const list = runJson<any[]>('memory list identity --json id');
        const found = list.find((m) => m.id === createdIdentityId);
        expect(found).toBeUndefined();
      });

      it('should error on invalid category', () => {
        expect(() => run('memory delete invalidcat some_id --yes')).toThrow();
      });
    });
  },
  { timeout: TIMEOUT },
);
