import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { genericContextFromResult, originFromEnv, scenarioFromResult, surfacesFromResult } from '.';

describe('surfacesFromResult — surface normalization', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('canonicalizes known aliases and dedupes', () => {
    expect(surfacesFromResult({ surfaces: ['electron', 'cli', 'desktop'] })).toEqual([
      'desktop',
      'cli',
    ]);
  });

  it('rejects a value that names no surface instead of silently dropping it', () => {
    // Free-form surfaces are how the field rotted: prose, runtime modes and test
    // kinds all ended up in it. Failing here puts the fix in the author's hands
    // while they still have the context to make it.
    expect(() =>
      surfacesFromResult({ surfaces: ['Electron 打包版（app.isPackaged=true）'] }),
    ).toThrow('process.exit');
    expect(() => surfacesFromResult({ surfaces: ['unit'] })).toThrow('process.exit');
  });

  it('returns undefined when the report names no surfaces at all', () => {
    expect(surfacesFromResult({})).toBeUndefined();
    expect(surfacesFromResult({ surfaces: [] })).toBeUndefined();
  });
});

describe('scenarioFromResult / genericContextFromResult — non-coding scenarios', () => {
  it('defaults to coding and passes any known scenario through', () => {
    expect(scenarioFromResult({})).toBe('coding');
    expect(scenarioFromResult({ scenario: 'research' })).toBe('research');
    expect(scenarioFromResult({ scenario: 'writing' })).toBe('writing');
    expect(scenarioFromResult({ scenario: 'generic' })).toBe('generic');
  });

  it('hard-errors on a scenario nothing renders', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`);
    }) as never);

    try {
      expect(() => scenarioFromResult({ scenario: 'poetry' })).toThrow('process.exit 1');
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('lifts shared provenance defaults but lets explicit context keys win', () => {
    expect(
      genericContextFromResult({
        context: { testedAt: '2026-07-16T10:00:00Z', wordCount: 82_000, work: '长夜' },
        createdAt: '2026-07-15T00:00:00Z',
        entry: 'lh doc export',
      }),
    ).toEqual({
      entry: 'lh doc export',
      testedAt: '2026-07-16T10:00:00Z',
      wordCount: 82_000,
      work: '长夜',
    });

    expect(genericContextFromResult({})).toBeUndefined();
  });
});

describe('originFromEnv — in-app provenance', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads the conversation the agent runtime echoed into the child env', () => {
    process.env.LOBEHUB_AGENT_ID = 'agt_1';
    process.env.LOBEHUB_TOPIC_ID = 'tpc_1';
    process.env.LOBEHUB_OPERATION_ID = 'op_1';

    expect(originFromEnv()).toEqual({
      agentId: 'agt_1',
      operationId: 'op_1',
      topicId: 'tpc_1',
    });
  });

  it('retains conversation provenance for persistent Pi without an authoring operation', () => {
    process.env.LOBEHUB_AGENT_ID = 'agt_pi';
    process.env.LOBEHUB_TOPIC_ID = 'tpc_pi';
    delete process.env.LOBEHUB_OPERATION_ID;

    expect(originFromEnv()).toEqual({
      agentId: 'agt_pi',
      operationId: undefined,
      topicId: 'tpc_pi',
    });
  });

  it('never takes its operationId from --operation, which names the run under TEST', () => {
    // `--operation` links the session to the Agent Run being verified; origin is
    // the run that AUTHORED the report. Conflating them attributes the report to
    // its own subject — exactly the provenance this is meant to preserve.
    process.env.LOBEHUB_OPERATION_ID = 'op_authoring_run';

    expect(originFromEnv()?.operationId).toBe('op_authoring_run');
    // The flag is passed to `createRun` separately; it must not reach here at all.
    expect(originFromEnv).toHaveLength(0);
  });

  it('is undefined outside a LobeHub-spawned agent — a plain terminal is not an error', () => {
    delete process.env.LOBEHUB_AGENT_ID;
    delete process.env.LOBEHUB_TOPIC_ID;
    delete process.env.LOBEHUB_OPERATION_ID;

    expect(originFromEnv()).toBeUndefined();
  });
});
