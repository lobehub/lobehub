import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh skill` agent skill management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 *
 * These tests create a real skill, verify CRUD operations, then clean up.
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

describe('lh skill - E2E', () => {
  const testName = `E2E-Skill-${Date.now()}`;
  const testDescription = 'Created by E2E test';
  const testContent = 'You are a helpful test skill.';
  const testIdentifier = `e2e-test-skill-${Date.now()}`;
  let createdId: string;

  // ── create ────────────────────────────────────────────

  describe('create', () => {
    it('should create a skill and return its id', () => {
      const output = run(
        `skill create -n "${testName}" -d "${testDescription}" -c "${testContent}" -i "${testIdentifier}"`,
      );
      expect(output).toContain('Created skill');

      // Extract id from output like "✓ Created skill xxx"
      const match = output.match(/Created skill\s+(\S+)/);
      expect(match).not.toBeNull();
      createdId = match![1];
    });

    it('should be viewable after creation', () => {
      const result = runJson<{ id: string; name: string }>(
        `skill view ${createdId} --json id,name`,
      );
      expect(result.id).toBe(createdId);
      expect(result.name).toBe(testName);
    });
  });

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should return valid output (table or empty message)', () => {
      const output = run('skill list');
      // May return table or "No skills found." depending on backend state
      expect(output).toBeTruthy();
    });

    it('should output JSON array', () => {
      const list = runJson<any[]>('skill list --json id,name');
      expect(Array.isArray(list)).toBe(true);
      if (list.length > 0) {
        expect(list[0]).toHaveProperty('id');
        expect(list[0]).toHaveProperty('name');
        expect(list[0]).not.toHaveProperty('content');
      }
    });

    it('should filter by source', () => {
      const list = runJson<{ id: string; source: string }[]>(
        'skill list --source user --json id,source',
      );
      expect(Array.isArray(list)).toBe(true);
      for (const item of list) {
        expect(item.source).toBe('user');
      }
    });
  });

  // ── view ──────────────────────────────────────────────

  describe('view', () => {
    it('should view skill details', () => {
      const output = run(`skill view ${createdId}`);
      expect(output).toContain(testName);
      expect(output).toContain(testDescription);
    });

    it('should output JSON with --json flag', () => {
      const result = runJson<{
        description: string;
        id: string;
        name: string;
      }>(`skill view ${createdId} --json id,name,description`);
      expect(result.id).toBe(createdId);
      expect(result.name).toBe(testName);
      expect(result.description).toBe(testDescription);
    });
  });

  // ── edit ──────────────────────────────────────────────

  describe('edit', () => {
    const updatedName = `${testName}-Updated`;
    const updatedDesc = 'Updated by E2E test';
    const updatedContent = 'Updated content for test skill.';

    it('should update skill name and description', () => {
      const output = run(`skill edit ${createdId} -n "${updatedName}" -d "${updatedDesc}"`);
      expect(output).toContain('Updated skill');
      expect(output).toContain(createdId);
    });

    it('should reflect name/description updates when viewed', () => {
      const result = runJson<{ description: string; name: string }>(
        `skill view ${createdId} --json name,description`,
      );
      expect(result.name).toBe(updatedName);
      expect(result.description).toBe(updatedDesc);
    });

    it('should update skill content', () => {
      const output = run(`skill edit ${createdId} -c "${updatedContent}"`);
      expect(output).toContain('Updated skill');
      expect(output).toContain(createdId);
    });

    it('should reflect content update when viewed', () => {
      const result = runJson<{ content: string }>(`skill view ${createdId} --json content`);
      expect(result.content).toBe(updatedContent);
    });

    it('should error when no changes specified', () => {
      expect(() => run(`skill edit ${createdId}`)).toThrow();
    });
  });

  // ── search ────────────────────────────────────────────

  describe('search', () => {
    it('should search skills in table format', () => {
      const output = run(`skill search "${testName}"`);
      // May or may not find results depending on indexing, but should not throw
      expect(typeof output).toBe('string');
    });

    it('should output JSON with --json flag', () => {
      const list = runJson<any[]>(`skill search "${testName}" --json id,name`);
      expect(Array.isArray(list)).toBe(true);
    });
  });

  // ── delete ────────────────────────────────────────────

  describe('delete', () => {
    it('should delete the skill', () => {
      const output = run(`skill delete ${createdId} --yes`);
      expect(output).toContain('Deleted skill');
      expect(output).toContain(createdId);
    });

    it('should no longer appear in the list', () => {
      const list = runJson<{ id: string }[]>('skill list --source user --json id');
      const found = list.find((s) => s.id === createdId);
      expect(found).toBeUndefined();
    });
  });
});
