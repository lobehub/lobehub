import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh model` AI model management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 * - At least one provider (e.g. openai) must be available
 *
 * These tests create a real model, verify CRUD operations, then clean up.
 */

const CLI = process.env.LH_CLI_PATH || 'lh';
const TIMEOUT = 30_000;
const TEST_PROVIDER = 'openai';

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

describe('lh model - E2E', () => {
  const testModelId = `e2e-model-${Date.now()}`;
  const testDisplayName = 'E2E Test Model';

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list models for a provider in table format', () => {
      const output = run(`model list ${TEST_PROVIDER}`);
      expect(output).toContain('ID');
      expect(output).toContain('NAME');
      expect(output).toContain('ENABLED');
      expect(output).toContain('TYPE');
    });

    it('should filter enabled models', () => {
      const output = run(`model list ${TEST_PROVIDER} --enabled`);
      // Every row should have ✓
      expect(output).not.toContain('✗');
    });

    it('should output JSON with field filtering', () => {
      const list = runJson<{ id: string; type: string }[]>(
        `model list ${TEST_PROVIDER} --json id,type -L 5`,
      );
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeLessThanOrEqual(5);
      if (list.length > 0) {
        expect(list[0]).toHaveProperty('id');
        expect(list[0]).toHaveProperty('type');
        expect(list[0]).not.toHaveProperty('displayName');
      }
    });

    it('should respect limit option', () => {
      const list = runJson<any[]>(`model list ${TEST_PROVIDER} --json id -L 3`);
      expect(list.length).toBeLessThanOrEqual(3);
    });
  });

  // ── create ────────────────────────────────────────────

  describe('create', () => {
    it('should create a new model', () => {
      const output = run(
        `model create --id ${testModelId} --provider ${TEST_PROVIDER} --display-name "${testDisplayName}" --type chat`,
      );
      expect(output).toContain('Created model');
    });

    it('should appear in the model list', () => {
      const list = runJson<{ id: string }[]>(`model list ${TEST_PROVIDER} --json id`);
      const found = list.find((m) => m.id === testModelId);
      expect(found).toBeDefined();
    });
  });

  // ── view ──────────────────────────────────────────────

  describe('view', () => {
    it('should view model details', () => {
      const output = run(`model view ${testModelId}`);
      expect(output).toContain(testDisplayName);
      expect(output).toContain(TEST_PROVIDER);
      expect(output).toContain('chat');
    });

    it('should output JSON', () => {
      const result = runJson<{
        displayName: string;
        id: string;
        providerId: string;
        type: string;
      }>(`model view ${testModelId} --json id,displayName,providerId,type`);
      expect(result.id).toBe(testModelId);
      expect(result.displayName).toBe(testDisplayName);
      expect(result.providerId).toBe(TEST_PROVIDER);
      expect(result.type).toBe('chat');
    });

    it('should error for nonexistent model', () => {
      expect(() => run('model view nonexistent-model-xyz')).toThrow();
    });
  });

  // ── edit ──────────────────────────────────────────────

  describe('edit', () => {
    const updatedName = `${testDisplayName}-Updated`;

    it('should update model display name', () => {
      const output = run(
        `model edit ${testModelId} --provider ${TEST_PROVIDER} --display-name "${updatedName}"`,
      );
      expect(output).toContain('Updated model');
    });

    it('should reflect updates when viewed', () => {
      const result = runJson<{ displayName: string }>(
        `model view ${testModelId} --json displayName`,
      );
      expect(result.displayName).toBe(updatedName);
    });

    it('should error when no changes specified', () => {
      expect(() => run(`model edit ${testModelId} --provider ${TEST_PROVIDER}`)).toThrow();
    });
  });

  // ── toggle ────────────────────────────────────────────

  describe('toggle', () => {
    it('should disable model', () => {
      const output = run(`model toggle ${testModelId} --provider ${TEST_PROVIDER} --disable`);
      expect(output).toContain('disabled');
    });

    it('should reflect disabled status', () => {
      const result = runJson<{ enabled: boolean }>(`model view ${testModelId} --json enabled`);
      expect(result.enabled).toBe(false);
    });

    it('should enable model', () => {
      const output = run(`model toggle ${testModelId} --provider ${TEST_PROVIDER} --enable`);
      expect(output).toContain('enabled');
    });

    it('should error when no flag specified', () => {
      expect(() => run(`model toggle ${testModelId} --provider ${TEST_PROVIDER}`)).toThrow();
    });
  });

  // ── batch-toggle ──────────────────────────────────────

  describe('batch-toggle', () => {
    it('should batch disable models', () => {
      const output = run(`model batch-toggle ${testModelId} --provider ${TEST_PROVIDER} --disable`);
      expect(output).toContain('Disabled');
      expect(output).toContain('1 model(s)');
    });

    it('should batch enable models', () => {
      const output = run(`model batch-toggle ${testModelId} --provider ${TEST_PROVIDER} --enable`);
      expect(output).toContain('Enabled');
      expect(output).toContain('1 model(s)');
    });
  });

  // ── delete (cleanup) ──────────────────────────────────

  describe('delete', () => {
    it('should delete the model', () => {
      const output = run(`model delete ${testModelId} --provider ${TEST_PROVIDER} --yes`);
      expect(output).toContain('Deleted model');
      expect(output).toContain(testModelId);
    });

    it('should no longer be viewable', () => {
      expect(() => run(`model view ${testModelId}`)).toThrow();
    });
  });

  // ── clear (test with caution) ─────────────────────────

  describe('clear', () => {
    it('should clear remote models for provider', () => {
      const output = run(`model clear --provider ${TEST_PROVIDER} --remote --yes`);
      expect(output).toContain('Cleared remote models');
      expect(output).toContain(TEST_PROVIDER);
    });
  });
});
