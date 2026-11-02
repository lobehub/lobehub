import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canonicalHash, findSensitiveHeader, hashPromptRequest, redactHeaders } from './canonical';
import { buildDatabaseUrl, parseDatabaseUrl } from './database';
import {
  getScenario,
  HARNESS_AGENT_PROMPT,
  HARNESS_BASELINE_USER_MESSAGE,
  PROMPT_SCENARIOS,
} from './fixtures';
import { assertHarnessPort } from './ports';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('prompt harness smoke', () => {
  it('defines every required scenario and a byte-identical legacy/on-demand pair', () => {
    const required = [
      'baseline-chat',
      'baseline-legacy',
      'baseline-on-demand',
      'budget-pressure',
      'document',
      'long-document',
      'manual-skill',
      'memory',
      'memory-expertise',
      'memory-follow-up',
      'negative-activation',
      'protected-budget',
      'skill',
      'skill-activation',
      'tool-activation',
      'ui-intervention',
    ];

    expect(PROMPT_SCENARIOS.map((scenario) => scenario.id).sort()).toEqual(required);
    expect(getScenario('baseline-chat').prompt).toBe(HARNESS_BASELINE_USER_MESSAGE);
    expect(getScenario('baseline-legacy').prompt).toBe(HARNESS_BASELINE_USER_MESSAGE);
    expect(getScenario('baseline-on-demand').prompt).toBe(HARNESS_BASELINE_USER_MESSAGE);
    expect(getScenario('baseline-chat').agentId).not.toBe(getScenario('baseline-legacy').agentId);
    expect(getScenario('baseline-legacy').agentId).not.toBe(
      getScenario('baseline-on-demand').agentId,
    );
    expect(getScenario('budget-pressure').expectation.degradeReasons).toEqual(['budget_exceeded']);

    const seed = readFileSync(
      path.join(repoRoot, 'scripts/promptHarness/fixtures/seed.sql'),
      'utf8',
    );
    expect(seed.match(/User-authored Agent Prompt/g) ?? []).toHaveLength(3);
    expect(seed).toContain('agt_yLie7JpbUr2K');
    expect(seed).toContain('agt_T101LEGACY01');
    expect(seed).toContain('agt_T106CHAT01');
    expect(seed).toContain('agt_T105BUDGET01');
    expect(seed).toContain('doc_t105_budget_pressure');
    expect(seed).not.toContain('t100-domain-approved');
    expect(getScenario('memory-expertise').beforeFixturePaths).toEqual([
      'scripts/promptHarness/fixtures/memoryExpertise.sql',
    ]);
    expect(getScenario('memory-expertise').afterFixturePaths).toEqual([
      'scripts/promptHarness/fixtures/memoryExpertiseCleanup.sql',
    ]);
    expect(HARNESS_AGENT_PROMPT.startsWith('  User-authored Agent Prompt\n\t')).toBe(true);
  });

  it('canonicalizes object keys but preserves message and tool array order', () => {
    const left = { messages: [{ content: 'same', role: 'user' }], tools: [{ b: 2, a: 1 }] };
    const right = { tools: [{ a: 1, b: 2 }], messages: [{ role: 'user', content: 'same' }] };
    const changed = {
      messages: [{ role: 'user', content: 'different' }],
      tools: [{ a: 1, b: 2 }],
    };

    expect(hashPromptRequest(left)).toEqual(hashPromptRequest(right));
    expect(hashPromptRequest(left).messages).not.toBe(hashPromptRequest(changed).messages);
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it('redacts every credential-bearing header without touching request data', () => {
    const fixtureValue = ['redaction', 'fixture'].join('-');
    const redactedMark = ['REDACTED'].join('');
    const raw = {
      'Authorization': `Bearer ${fixtureValue}`,
      'Cookie': `session=${fixtureValue}`,
      'content-type': 'application/json',
      'X-Api-Key': fixtureValue,
    };

    expect(findSensitiveHeader(raw)).toBe('Authorization');
    expect(redactHeaders(raw)).toEqual({
      'Authorization': `[${redactedMark}]`,
      'Cookie': `[${redactedMark}]`,
      'content-type': 'application/json',
      'X-Api-Key': `[${redactedMark}]`,
    });
    expect(findSensitiveHeader(redactHeaders(raw))).toBeUndefined();
  });

  it('rejects shared ports and preserves database credentials when cloning the URL', () => {
    expect(() => assertHarnessPort(3010)).toThrow('Refusing shared/development port');
    expect(() => assertHarnessPort(3311)).toThrow('Refusing shared/development port');
    expect(assertHarnessPort(43_211)).toBe(43_211);

    const fixtureValue = ['db', 'fixture'].join('-');
    const parts = parseDatabaseUrl(
      `postgresql://test_user:${fixtureValue}@127.0.0.1:5433/source_db`,
    );
    expect(parts).toMatchObject({
      database: 'source_db',
      host: '127.0.0.1',
      port: '5433',
      user: 'test_user',
    });
    const cloned = buildDatabaseUrl(parts, 't105_clone');
    expect(cloned).toContain(`test_user:${fixtureValue}@`);
    expect(cloned.endsWith('/t105_clone')).toBe(true);
  });

  it('uses a lock, ephemeral ports and process-group teardown in the stack entrypoint', () => {
    const script = readFileSync(path.join(repoRoot, 'scripts/promptHarness/stack.sh'), 'utf8');
    expect(script).toContain('flock -n 9');
    expect(script).toContain('PROMPT_HARNESS_ENV=test');
    expect(script).toContain('source .env');
    expect(script).not.toContain('_dangerous_local_dev_proxy');
  });
});
