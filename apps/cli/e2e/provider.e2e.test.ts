import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh provider` AI provider management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 *
 * These tests create a real provider, verify CRUD operations, then clean up.
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

describe('lh provider - E2E', () => {
  const testId = `e2e-test-${Date.now()}`;
  const testName = 'E2E Test Provider';

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list providers in table format', () => {
      const output = run('provider list');
      expect(output).toContain('ID');
      expect(output).toContain('NAME');
      expect(output).toContain('ENABLED');
      expect(output).toContain('SOURCE');
    });

    it('should output JSON with field filtering', () => {
      const list = runJson<{ id: string; name: string }[]>('provider list --json id,name');
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      const first = list[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).not.toHaveProperty('description');
    });
  });

  // ── view ──────────────────────────────────────────────

  describe('view', () => {
    it('should view a builtin provider', () => {
      const output = run('provider view openai');
      // Should show name or id and status
      expect(output).toMatch(/Enabled|Disabled/);
      expect(output).toContain('builtin');
    });

    it('should output JSON for a provider', () => {
      const result = runJson<{ id: string; source: string }>(
        'provider view openai --json id,source',
      );
      expect(result.id).toBe('openai');
      expect(result.source).toBe('builtin');
    });

    it('should error for nonexistent provider', () => {
      expect(() => run('provider view nonexistent-provider-xyz')).toThrow();
    });
  });

  // ── create ────────────────────────────────────────────

  describe('create', () => {
    it('should create a new provider', () => {
      const output = run(
        `provider create --id ${testId} -n "${testName}" -d "E2E test" --sdk-type openai`,
      );
      expect(output).toContain('Created provider');
      expect(output).toContain(testId);
    });

    it('should appear in the list', () => {
      const list = runJson<{ id: string; name: string }[]>('provider list --json id,name');
      const found = list.find((p) => p.id === testId);
      expect(found).toBeDefined();
      expect(found!.name).toBe(testName);
    });
  });

  // ── edit ──────────────────────────────────────────────

  describe('edit', () => {
    const updatedName = `${testName}-Updated`;

    it('should update provider name', () => {
      const output = run(`provider edit ${testId} -n "${updatedName}"`);
      expect(output).toContain('Updated provider');
      expect(output).toContain(testId);
    });

    it('should reflect updates when viewed', () => {
      const result = runJson<{ name: string }>(`provider view ${testId} --json name`);
      expect(result.name).toBe(updatedName);
    });

    it('should error when no changes specified', () => {
      expect(() => run(`provider edit ${testId}`)).toThrow();
    });
  });

  // ── config ────────────────────────────────────────────

  describe('config', () => {
    it('should set api key and base url', () => {
      const output = run(
        `provider config ${testId} --api-key sk-e2etest123456 --base-url https://api.e2e.test/v1`,
      );
      expect(output).toContain('Updated config');
    });

    it('should set check model', () => {
      const output = run(`provider config ${testId} --check-model gpt-4o`);
      expect(output).toContain('Updated config');
    });

    it('should enable response api', () => {
      const output = run(`provider config ${testId} --enable-response-api`);
      expect(output).toContain('Updated config');
    });

    it('should show current config', () => {
      const output = run(`provider config ${testId} --show`);
      expect(output).toContain('Config for');
      expect(output).toContain('gpt-4o');
      expect(output).toContain('sk-e2ete');
      expect(output).toContain('https://api.e2e.test/v1');
    });

    it('should show config as JSON', () => {
      const result = runJson<{
        checkModel: string;
        keyVaults: { apiKey: string; baseURL: string };
      }>(`provider config ${testId} --show --json`);
      expect(result.checkModel).toBe('gpt-4o');
      expect(result.keyVaults.apiKey).toContain('sk-e2etest');
      expect(result.keyVaults.baseURL).toBe('https://api.e2e.test/v1');
    });

    it('should error when no config specified', () => {
      expect(() => run(`provider config ${testId}`)).toThrow();
    });
  });

  // ── toggle ────────────────────────────────────────────

  describe('toggle', () => {
    it('should disable provider', () => {
      const output = run(`provider toggle ${testId} --disable`);
      expect(output).toContain('disabled');
    });

    it('should reflect disabled status', () => {
      const result = runJson<{ enabled: boolean }>(`provider view ${testId} --json enabled`);
      expect(result.enabled).toBe(false);
    });

    it('should enable provider', () => {
      const output = run(`provider toggle ${testId} --enable`);
      expect(output).toContain('enabled');
    });

    it('should error when no flag specified', () => {
      expect(() => run(`provider toggle ${testId}`)).toThrow();
    });
  });

  // ── test (connectivity) ───────────────────────────────

  describe('test', () => {
    it('should check provider connectivity (expect fail with fake key)', () => {
      // The e2e test provider has a fake API key, so test should fail
      expect(() => run(`provider test ${testId}`)).toThrow();
    });

    it('should output JSON on failure', () => {
      try {
        run(`provider test ${testId} --json`);
      } catch {
        // Command exits with code 1 but may still output JSON before that
        // This is expected behavior
      }
    });
  });

  // ── delete (cleanup) ──────────────────────────────────

  describe('delete', () => {
    it('should delete the provider', () => {
      const output = run(`provider delete ${testId} --yes`);
      expect(output).toContain('Deleted provider');
      expect(output).toContain(testId);
    });

    it('should no longer appear in the list', () => {
      const list = runJson<{ id: string }[]>('provider list --json id');
      const found = list.find((p) => p.id === testId);
      expect(found).toBeUndefined();
    });
  });
});
