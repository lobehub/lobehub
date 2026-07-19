import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveReportVerdict,
  genericContextFromResult,
  originFromEnv,
  parseSubjectRef,
  planFromResult,
  registerVerifyCommand,
  reportEvidence,
  scenarioFromResult,
  subjectFromEnv,
  subjectFromResult,
  surfacesFromResult,
} from './verify';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    verify: {
      createRubric: { mutate: vi.fn() },
      deleteRun: { mutate: vi.fn() },
      getRubric: { query: vi.fn() },
      getSkillBundle: { query: vi.fn() },
      updateRubric: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('verify rubric config commands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.verify.createRubric.mutate.mockReset().mockResolvedValue({ id: 'rub-1' });
    mockTrpcClient.verify.updateRubric.mutate.mockReset().mockResolvedValue(undefined);
    mockTrpcClient.verify.getRubric.query.mockReset();
  });

  afterEach(() => consoleSpy.mockRestore());

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('passes maxRepairRounds config when creating a rubric', async () => {
    await run(['rubric', 'create', '-t', 'Standard', '--max-repair-rounds', '3']);

    expect(mockTrpcClient.verify.createRubric.mutate).toHaveBeenCalledWith({
      config: { maxRepairRounds: 3 },
      description: undefined,
      title: 'Standard',
    });
  });

  it('omits config when no max-repair-rounds flag is given', async () => {
    await run(['rubric', 'create', '-t', 'Standard']);

    expect(mockTrpcClient.verify.createRubric.mutate).toHaveBeenCalledWith({
      config: undefined,
      description: undefined,
      title: 'Standard',
    });
  });

  it('updates only the config when max-repair-rounds is passed', async () => {
    await run(['rubric', 'update', 'rub-1', '--max-repair-rounds', '0']);

    expect(mockTrpcClient.verify.updateRubric.mutate).toHaveBeenCalledWith({
      id: 'rub-1',
      value: { config: { maxRepairRounds: 0 } },
    });
  });

  it('views a rubric and prints its repair-round config', async () => {
    mockTrpcClient.verify.getRubric.query.mockResolvedValue({
      config: { maxRepairRounds: 4 },
      description: 'desc',
      id: 'rub-1',
      title: 'Standard',
    });

    await run(['rubric', 'view', 'rub-1']);

    expect(mockTrpcClient.verify.getRubric.query).toHaveBeenCalledWith({ id: 'rub-1' });
    const printed = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Standard');
    expect(printed).toContain('4');
  });
});

describe('verify run delete command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.verify.deleteRun.mutate.mockReset().mockResolvedValue({
      id: 'run-1',
      success: true,
    });
  });

  afterEach(() => consoleSpy.mockRestore());

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('deletes the run without prompting when --yes is passed', async () => {
    await run(['run', 'delete', 'run-1', '--yes']);

    expect(mockTrpcClient.verify.deleteRun.mutate).toHaveBeenCalledWith({ verifyRunId: 'run-1' });
  });
});

describe('verify evidence upload command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetTrpcClient.mockReset();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`);
    }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('rejects evidence with both file and inline content', async () => {
    await expect(
      run([
        'evidence',
        'upload',
        '--check',
        'result-1',
        '--type',
        'text',
        '--file',
        'artifact.txt',
        '--content',
        'inline payload',
      ]),
    ).rejects.toThrow('process.exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGetTrpcClient).not.toHaveBeenCalled();
  });
});

describe('verify init command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.verify.getSkillBundle.query.mockReset().mockResolvedValue({
      content: '# Verify SKILL',
      files: { 'references/plan-format.md': 'plan', 'surfaces/cli.md': 'cli' },
      identifier: 'verify',
      name: 'verify',
    });
    dir = mkdtempSync(path.join(tmpdir(), 'verify-init-'));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(dir, { force: true, recursive: true });
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('writes SKILL.md and resource files into .claude/skills/verify', async () => {
    await run(['init', '--dir', dir]);

    expect(mockTrpcClient.verify.getSkillBundle.query).toHaveBeenCalledWith({
      identifier: 'verify',
    });
    const skillDir = path.join(dir, '.claude', 'skills', 'verify');
    expect(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe('# Verify SKILL');
    expect(readFileSync(path.join(skillDir, 'references/plan-format.md'), 'utf8')).toBe('plan');
    expect(readFileSync(path.join(skillDir, 'surfaces/cli.md'), 'utf8')).toBe('cli');
  });

  it('skips existing files without --force and overwrites with it', async () => {
    const skillFile = path.join(dir, '.claude', 'skills', 'verify', 'SKILL.md');
    await run(['init', '--dir', dir]);

    // server now serves updated content
    mockTrpcClient.verify.getSkillBundle.query.mockResolvedValue({
      content: '# Updated SKILL',
      files: {},
      identifier: 'verify',
      name: 'verify',
    });

    await run(['init', '--dir', dir]); // no --force → keep existing
    expect(readFileSync(skillFile, 'utf8')).toBe('# Verify SKILL');

    await run(['init', '--dir', dir, '--force']); // --force → overwrite
    expect(readFileSync(skillFile, 'utf8')).toBe('# Updated SKILL');
  });

  it('reports the written/skipped counts as JSON', async () => {
    await run(['init', '--dir', dir, '--json']);
    const out = JSON.parse(consoleSpy.mock.calls.map((c) => String(c[0])).join(''));
    expect(out.skill).toBe('verify');
    expect(out.written).toContain('SKILL.md');
    expect(existsSync(path.join(out.dir, 'SKILL.md'))).toBe(true);
  });
});

describe('reportEvidence — comparison normalization', () => {
  it('accepts plain string paths', () => {
    expect(reportEvidence('assets/a.png')).toEqual([{ path: 'assets/a.png' }]);
    expect(reportEvidence(['a.png', 'b.png']).map((e) => e.path)).toEqual(['a.png', 'b.png']);
  });

  it('keeps a comparison that carries both an id and a before/after role', () => {
    const [before, after] = reportEvidence([
      { comparison: { id: 'row', role: 'before' }, path: 'before.png' },
      { comparison: { id: 'row', label: '改后', role: 'after' }, path: 'after.png' },
    ]);

    expect(before.comparison).toEqual({
      id: 'row',
      label: undefined,
      layout: undefined,
      role: 'before',
    });
    expect(after.comparison).toEqual({
      id: 'row',
      label: '改后',
      layout: undefined,
      role: 'after',
    });
  });

  it('passes a vertical layout through and ignores any other value', () => {
    const forLayout = (layout: unknown) =>
      reportEvidence([{ comparison: { id: 'row', layout, role: 'before' }, path: 'a.png' }])[0]
        .comparison?.layout;

    expect(forLayout('vertical')).toBe('vertical');
    // Side by side is the default, so anything unrecognized simply falls back to it.
    expect(forLayout('horizontal')).toBeUndefined();
    expect(forLayout('diagonal')).toBeUndefined();
    expect(forLayout(undefined)).toBeUndefined();
  });

  // The report viewer pairs on `id`, so an id-less comparison could never render
  // side by side — dropping it here keeps the upload honest instead of shipping
  // metadata the UI silently ignores.
  it('drops a comparison missing an id, keeping the image as ordinary evidence', () => {
    const [item] = reportEvidence([{ comparison: { role: 'before' }, path: 'before.png' }]);

    expect(item).toEqual({ comparison: undefined, description: undefined, path: 'before.png' });
  });

  it('drops a comparison whose role is absent or unrecognized', () => {
    expect(
      reportEvidence([{ comparison: { id: 'x', role: 'middle' }, path: 'a.png' }])[0].comparison,
    ).toBeUndefined();
    expect(
      reportEvidence([{ comparison: { id: 'x' }, path: 'a.png' }])[0].comparison,
    ).toBeUndefined();
  });

  it('supports the `file` / `desc` aliases and skips entries with no path', () => {
    expect(
      reportEvidence([{ desc: 'a shot', file: 'a.png' }, { comparison: { id: 'x' } }]),
    ).toEqual([{ comparison: undefined, description: 'a shot', path: 'a.png' }]);
  });
});

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

describe('planFromResult — plan item normalization', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('fills every frozen-item field the author does not write', () => {
    expect(planFromResult({ plan: [{ id: '1', title: 'logs are persisted' }] })).toEqual([
      {
        description: undefined,
        id: '1',
        index: 0,
        onFail: 'manual',
        required: true,
        title: 'logs are persisted',
        verifierConfig: {},
        verifierType: 'agent',
      },
    ]);
  });

  it('honors the declared verifier instead of assuming every check is agent-judged', () => {
    const [item] = planFromResult({
      plan: [{ id: '1', title: 'cli returns a tree', verifier: 'program' }],
    })!;

    expect(item.verifierType).toBe('program');
  });

  it('carries requiredEvidence, which the executor coverage gate actually enforces', () => {
    const [item] = planFromResult({
      plan: [
        {
          id: '1',
          requiredEvidence: ['screenshot', { hint: 'the raw command output', type: 'text' }],
          title: 'ui renders',
        },
      ],
    })!;

    expect(item.verifierConfig).toEqual({
      requiredEvidence: [
        { hint: undefined, type: 'screenshot' },
        { hint: 'the raw command output', type: 'text' },
      ],
    });
  });

  it('rejects an out-of-vocabulary verifier or evidence medium', () => {
    // An unrecognized medium would gate on nothing — silently weaker than no gate.
    expect(() => planFromResult({ plan: [{ id: '1', title: 't', verifier: 'eyeball' }] })).toThrow(
      'process.exit',
    );
    expect(() =>
      planFromResult({ plan: [{ id: '1', requiredEvidence: ['vibes'], title: 't' }] }),
    ).toThrow('process.exit');
  });

  it('carries how the check would be made and what it expected', () => {
    const [item] = planFromResult({
      plan: [{ expected: 'the file exists', id: '1', method: 'tail the log', title: 'logs' }],
    })!;

    expect(item.verifierConfig).toEqual({ expected: 'the file exists', method: 'tail the log' });
  });

  it('normalizes a per-item surface and drops one that names no surface', () => {
    const items = planFromResult({
      plan: [
        { id: '1', surface: 'electron', title: 'tray dedupe' },
        { id: '2', surface: 'unit', title: 'model test' },
        { id: '3', title: 'no surface' },
      ],
    })!;

    expect(items[0].verifierConfig).toEqual({ surface: 'desktop' });
    expect(items[1].verifierConfig).toEqual({});
    expect(items[2].verifierConfig).toEqual({});
  });

  it('keys items by the same id the cases use, so results pair back to them', () => {
    const items = planFromResult({ plan: [{ id: 'case-a', title: 'a' }, { title: 'b' }] })!;

    expect(items.map((i) => i.id)).toEqual(['case-a', 'case-2']);
  });

  it('drops an item that names no check', () => {
    expect(planFromResult({ plan: [{ id: '1' }] })).toEqual([]);
  });

  it('distinguishes "no plan field" from an explicitly empty plan', () => {
    // Absent → undefined: this snapshot did not declare a plan.
    expect(planFromResult({})).toBeUndefined();

    // Present but empty → `[]`: this snapshot explicitly planned no checks.
    expect(planFromResult({ plan: [] })).toEqual([]);
  });
});

describe('verify ingest-report — every run is an immutable acceptance round', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    const verify = mockTrpcClient.verify as Record<string, any>;
    verify.createRun = { mutate: vi.fn().mockResolvedValue({ id: 'run-new' }) };
    verify.updateRun = { mutate: vi.fn() };
    verify.upsertReport = { mutate: vi.fn().mockResolvedValue({}) };
    mockTrpcClient.acceptance = {
      attachRun: { mutate: vi.fn() },
      ensure: { mutate: vi.fn().mockResolvedValue({ id: 'acceptance-1' }) },
    };

    dir = mkdtempSync(path.join(tmpdir(), 'lh-ingest-'));
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ cases: [] }));
    process.env.LOBEHUB_TOPIC_ID = 'topic-1';
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env.LOBEHUB_TOPIC_ID;
    rmSync(dir, { force: true, recursive: true });
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('creates a fresh run and binds it to the current topic acceptance', async () => {
    const verify = mockTrpcClient.verify as Record<string, any>;

    await run(['ingest-report', dir, '--json']);

    expect(verify.updateRun.mutate).not.toHaveBeenCalled();
    expect(verify.createRun.mutate).toHaveBeenCalled();
    expect(mockTrpcClient.acceptance.ensure.mutate).toHaveBeenCalledWith({
      requirement: undefined,
      subjectId: 'topic-1',
      subjectType: 'topic',
    });
    expect(mockTrpcClient.acceptance.attachRun.mutate).toHaveBeenCalledWith({
      acceptanceId: 'acceptance-1',
      verifyRunId: 'run-new',
    });
  });

  it('passes a non-coding scenario and its context bag through to the run', async () => {
    const verify = mockTrpcClient.verify as Record<string, any>;
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [],
        context: { question: 'How mature is X?', sourceCount: 8 },
        scenario: 'research',
      }),
    );

    await run(['ingest-report', dir, '--json']);

    expect(verify.createRun.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ question: 'How mature is X?', sourceCount: 8 }),
        scenario: 'research',
      }),
    );
  });

  it('finishes the human (non-json) output path for a non-coding report', async () => {
    // Regression: `pullRequest` was block-scoped inside the coding branch while
    // the text success output still read it, so every non-json ingest crashed
    // with a ReferenceError AFTER creating the run.
    const verify = mockTrpcClient.verify as Record<string, any>;
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [],
        context: { question: 'How mature is X?' },
        scenario: 'research',
      }),
    );

    await run(['ingest-report', dir]);

    expect(verify.createRun.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: 'research' }),
    );
    // The success tail printed — the command reached past the run creation.
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('verifyRunId'));
  });

  it('rejects an unknown scenario instead of silently tagging the run coding', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`);
    }) as never);
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ cases: [], scenario: 'poetry' }));

    try {
      await expect(run(['ingest-report', dir, '--json'])).rejects.toThrow('process.exit 1');
      expect(
        (mockTrpcClient.verify as Record<string, any>).createRun.mutate,
      ).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('creates another run when the same report directory is ingested again', async () => {
    const verify = mockTrpcClient.verify as Record<string, any>;
    verify.createRun.mutate
      .mockResolvedValueOnce({ id: 'run-first' })
      .mockResolvedValueOnce({ id: 'run-second' });

    await run(['ingest-report', dir, '--json']);
    await run(['ingest-report', dir, '--json']);

    expect(verify.createRun.mutate).toHaveBeenCalledTimes(2);
    expect(mockTrpcClient.acceptance.attachRun.mutate).toHaveBeenNthCalledWith(1, {
      acceptanceId: 'acceptance-1',
      verifyRunId: 'run-first',
    });
    expect(mockTrpcClient.acceptance.attachRun.mutate).toHaveBeenNthCalledWith(2, {
      acceptanceId: 'acceptance-1',
      verifyRunId: 'run-second',
    });
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

describe('parseSubjectRef / subjectFromResult — acceptance subject', () => {
  it('parses the closed set of type:id references', () => {
    expect(parseSubjectRef('task:task_123')).toEqual({
      subjectId: 'task_123',
      subjectType: 'task',
    });
    expect(parseSubjectRef('topic:tpc_abc')).toEqual({
      subjectId: 'tpc_abc',
      subjectType: 'topic',
    });
    expect(parseSubjectRef('document:doc_1')).toEqual({
      subjectId: 'doc_1',
      subjectType: 'document',
    });
  });

  it('rejects unknown types and malformed references', () => {
    expect(parseSubjectRef('release:rel_1')).toBeNull();
    expect(parseSubjectRef('task:')).toBeNull();
    expect(parseSubjectRef('task_123')).toBeNull();
    expect(parseSubjectRef(undefined)).toBeNull();
  });

  it('keeps an id containing colons intact (splits on the FIRST colon only)', () => {
    expect(parseSubjectRef('topic:tpc:odd:id')).toEqual({
      subjectId: 'tpc:odd:id',
      subjectType: 'topic',
    });
  });

  it('reads result.json subject in both string and object shapes', () => {
    expect(subjectFromResult({ subject: 'task:task_9' })).toEqual({
      ref: { subjectId: 'task_9', subjectType: 'task' },
    });
    expect(
      subjectFromResult({
        subject: { id: 'tpc_1', requirement: 'no regressions', type: 'topic' },
      }),
    ).toEqual({
      ref: { subjectId: 'tpc_1', subjectType: 'topic' },
      requirement: 'no regressions',
    });
  });

  it('returns null on a malformed subject field instead of guessing', () => {
    expect(subjectFromResult({})).toBeNull();
    expect(subjectFromResult({ subject: 'nonsense' })).toBeNull();
    expect(subjectFromResult({ subject: { id: 'x' } })).toBeNull();
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

describe('deriveReportVerdict — headline fallback when summary.verdict is absent', () => {
  it('derives passed when every case passed', () => {
    expect(deriveReportVerdict([{ result: 'passed' }, { result: 'ok' }])).toBe('passed');
  });

  it('any failed case fails the report', () => {
    expect(deriveReportVerdict([{ result: 'passed' }, { result: 'failed' }])).toBe('failed');
  });

  it('a non-passed, non-failed case makes the report uncertain', () => {
    expect(deriveReportVerdict([{ result: 'passed' }, { result: 'blocked' }])).toBe('uncertain');
  });

  it('no cases → no derived verdict', () => {
    expect(deriveReportVerdict([])).toBeUndefined();
  });
});

describe('subjectFromEnv — default topic acceptance', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('binds an in-app run to its authoring topic', () => {
    process.env.LOBEHUB_TOPIC_ID = 'tpc_1';

    expect(subjectFromEnv()).toEqual({ subjectId: 'tpc_1', subjectType: 'topic' });
  });

  it('requires an explicit subject outside a topic', () => {
    delete process.env.LOBEHUB_TOPIC_ID;

    expect(subjectFromEnv()).toBeNull();
  });
});
