import { execSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh model` AI model management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 *
 * The suite owns a uniquely named provider and deletes it after the run. It
 * never changes models belonging to an existing provider on the user account.
 */

const CLI = process.env.LH_CLI_PATH || 'lh';
const TIMEOUT = 30_000;
const suiteId = `${Date.now()}-${process.pid}`;
const TEST_PROVIDER = `e2e-model-provider-${suiteId}`;
const TEST_PROVIDER_NAME = `E2E Model Provider ${suiteId}`;

const listFixtures = [
  { enabled: true, id: `e2e-list-chat-a-${suiteId}`, type: 'chat' },
  { enabled: true, id: `e2e-list-chat-b-${suiteId}`, type: 'chat' },
  { enabled: true, id: `e2e-list-embedding-${suiteId}`, type: 'embedding' },
  { enabled: false, id: `e2e-list-disabled-chat-${suiteId}`, type: 'chat' },
  { enabled: false, id: `e2e-list-disabled-tts-${suiteId}`, type: 'tts' },
] as const;

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    timeout: TIMEOUT,
  }).trim();
}

function runJson<T>(args: string): T {
  const output = run(args);
  return JSON.parse(output) as T;
}

describe('lh model - E2E', () => {
  const testModelId = `e2e-model-${suiteId}`;
  const testDisplayName = 'E2E Test Model';
  let providerCreated = false;

  beforeAll(() => {
    run(
      `provider create --id ${TEST_PROVIDER} --name "${TEST_PROVIDER_NAME}" --source custom --sdk-type openai`,
    );
    providerCreated = true;

    for (const fixture of listFixtures) {
      run(
        `model create --id ${fixture.id} --provider ${TEST_PROVIDER} --display-name "${fixture.id}" --type ${fixture.type}`,
      );
      if (!fixture.enabled) {
        run(`model toggle ${fixture.id} --provider ${TEST_PROVIDER} --disable`);
      }
    }
  }, TIMEOUT * 2);

  afterAll(() => {
    if (providerCreated) run(`provider delete ${TEST_PROVIDER} --yes`);
  });

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list the suite models for a provider in table format', () => {
      const output = run(`model list ${TEST_PROVIDER}`);
      expect(output).toContain('ID');
      expect(output).toContain('NAME');
      expect(output).toContain('ENABLED');
      expect(output).toContain('TYPE');
      for (const fixture of listFixtures) expect(output).toContain(fixture.id);
    });

    it('should return only the enabled fixture models', () => {
      const list = runJson<{ enabled: boolean; id: string }[]>(
        `model list ${TEST_PROVIDER} --enabled --json id,enabled`,
      );
      const ids = list.map(({ id }) => id);

      expect(ids).toEqual(
        expect.arrayContaining(listFixtures.filter((model) => model.enabled).map(({ id }) => id)),
      );
      expect(ids).not.toEqual(
        expect.arrayContaining(listFixtures.filter((model) => !model.enabled).map(({ id }) => id)),
      );
      expect(list.every(({ enabled }) => enabled)).toBe(true);
    });

    it('should output JSON with field filtering', () => {
      const list = runJson<{ id: string; type: string }[]>(
        `model list ${TEST_PROVIDER} --json id,type -L 5`,
      );
      expect(list).toHaveLength(5);
      expect(list.map(({ id }) => id)).toEqual(
        expect.arrayContaining(listFixtures.map(({ id }) => id)),
      );
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('type');
      expect(list[0]).not.toHaveProperty('displayName');
    });

    it('should respect limit option with more fixtures than the limit', () => {
      const list = runJson<{ id: string }[]>(`model list ${TEST_PROVIDER} --json id -L 3`);
      expect(list).toHaveLength(3);
      expect(list.every(({ id }) => listFixtures.some((fixture) => fixture.id === id))).toBe(true);
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
      expect(list.some(({ id }) => id === testModelId)).toBe(true);
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
      expect(() => run(`model view nonexistent-model-${suiteId}`)).toThrow();
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

  // ── delete ────────────────────────────────────────────

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

  // ── clear ─────────────────────────────────────────────

  describe('clear', () => {
    it('should clear a remote model while preserving a custom model', () => {
      const remoteModelId = `e2e-remote-${suiteId}`;
      const customModelId = `e2e-custom-${suiteId}`;
      const remoteModels = JSON.stringify([
        {
          displayName: 'E2E Remote Model',
          enabled: true,
          id: remoteModelId,
          source: 'remote',
          type: 'chat',
        },
      ]);
      run(`model batch-update ${TEST_PROVIDER} --models '${remoteModels}'`);
      run(
        `model create --id ${customModelId} --provider ${TEST_PROVIDER} --display-name "E2E Custom Model" --type chat`,
      );

      const seeded = runJson<{ id: string; source: string }[]>(
        `model list ${TEST_PROVIDER} --json id,source`,
      );
      expect(seeded).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: remoteModelId, source: 'remote' }),
          expect.objectContaining({ id: customModelId, source: 'custom' }),
        ]),
      );

      const output = run(`model clear --provider ${TEST_PROVIDER} --remote --yes`);
      expect(output).toContain('Cleared remote models');
      expect(output).toContain(TEST_PROVIDER);

      const remaining = runJson<{ id: string }[]>(`model list ${TEST_PROVIDER} --json id`).map(
        ({ id }) => id,
      );
      expect(remaining).not.toContain(remoteModelId);
      expect(remaining).toContain(customModelId);
    });
  });
});
