import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import {
  deriveReportVerdict,
  evidenceTypeForFile,
  formatAnnotationRegion,
  genericContextFromResult,
  inlineTextEvidenceForFile,
  originFromEnv,
  parseSubjectRef,
  planFromResult,
  registerVerifyCommand,
  reportEvidence,
  scenarioFromResult,
  screenProgrammaticTestChecks,
  subjectFromEnv,
  subjectFromResult,
  surfacesFromResult,
  visualizationMetadata,
} from './verify';
import { registerAcceptanceCommands } from './verifyAcceptance';

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
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://app.lobehub.com' }));
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
      content: '# Acceptance SKILL',
      files: { 'references/plan-format.md': 'plan', 'surfaces/cli.md': 'cli' },
      identifier: 'acceptance',
      name: 'acceptance',
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

  it('defaults to the acceptance skill and writes it into .agents/skills/acceptance', async () => {
    await run(['init', '--dir', dir]);

    expect(mockTrpcClient.verify.getSkillBundle.query).toHaveBeenCalledWith({
      identifier: 'acceptance',
    });
    const skillDir = path.join(dir, '.agents', 'skills', 'acceptance');
    expect(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe('# Acceptance SKILL');
    expect(readFileSync(path.join(skillDir, 'references/plan-format.md'), 'utf8')).toBe('plan');
    expect(readFileSync(path.join(skillDir, 'surfaces/cli.md'), 'utf8')).toBe('cli');
  });

  it('skips existing files without --force and overwrites with it', async () => {
    const skillFile = path.join(dir, '.agents', 'skills', 'acceptance', 'SKILL.md');
    await run(['init', '--dir', dir]);

    // server now serves updated content
    mockTrpcClient.verify.getSkillBundle.query.mockResolvedValue({
      content: '# Updated SKILL',
      files: {},
      identifier: 'acceptance',
      name: 'acceptance',
    });

    await run(['init', '--dir', dir]); // no --force → keep existing
    expect(readFileSync(skillFile, 'utf8')).toBe('# Acceptance SKILL');

    await run(['init', '--dir', dir, '--force']); // --force → overwrite
    expect(readFileSync(skillFile, 'utf8')).toBe('# Updated SKILL');
  });

  it('reports the written/skipped counts as JSON', async () => {
    await run(['init', '--dir', dir, '--json']);
    const out = JSON.parse(consoleSpy.mock.calls.map((c) => String(c[0])).join(''));
    expect(out.skill).toBe('acceptance');
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

  // The flat shape (`comparison: "row", role: "before"`) is the easiest one to
  // write from memory, and it used to be the ONLY malformed shape that produced
  // no warning: the guard parsed the field into an object first, so a string
  // read as "no comparison at all" and the ingest exited clean while the page
  // rendered two unpaired images.
  it('warns and drops a comparison that is not an object', () => {
    vi.mocked(log.warn).mockClear();

    const [item] = reportEvidence([
      { comparison: 'row', path: 'before.png', role: 'before' } as unknown,
    ]);

    expect(item).toEqual({ comparison: undefined, description: undefined, path: 'before.png' });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('before.png'));
  });

  it('warns for every malformed comparison shape, and stays quiet for a valid or absent one', () => {
    const warnsFor = (comparison: unknown) => {
      vi.mocked(log.warn).mockClear();
      reportEvidence([{ comparison, path: 'a.png' } as unknown]);
      return vi.mocked(log.warn).mock.calls.length > 0;
    };

    expect(warnsFor('row')).toBe(true);
    expect(warnsFor(['row'])).toBe(true);
    expect(warnsFor({ id: 'row' })).toBe(true);
    expect(warnsFor({ id: 'row', role: 'middle' })).toBe(true);

    // Falsy but present: someone wrote the field, so it is malformed rather
    // than absent. A truthiness guard would drop these without a word.
    expect(warnsFor('')).toBe(true);
    expect(warnsFor(0)).toBe(true);
    expect(warnsFor(false)).toBe(true);
    expect(warnsFor(Number.NaN)).toBe(true);

    // Absent is null/undefined only — an evidence item without a pair.
    expect(warnsFor({ id: 'row', role: 'before' })).toBe(false);
    expect(warnsFor(undefined)).toBe(false);
    expect(warnsFor(null)).toBe(false);
  });

  it('supports the `file` / `desc` aliases and skips entries with no path', () => {
    expect(
      reportEvidence([{ desc: 'a shot', file: 'a.png' }, { comparison: { id: 'x' } }]),
    ).toEqual([{ comparison: undefined, description: 'a shot', path: 'a.png' }]);
  });
});

describe('visualizationMetadata', () => {
  const input = {
    datasets: [
      {
        fields: [
          { key: 'name', type: 'string' },
          { key: 'before', type: 'number', unit: 'ms' },
          { key: 'after', type: 'number', unit: 'ms' },
        ],
        id: 'metrics',
        rows: [{ after: 24.8, before: 257, name: 'GC self-time' }],
      },
    ],
    visualizations: [
      {
        dataset: 'metrics',
        encoding: { after: 'after', before: 'before', label: 'name' },
        id: 'performance',
        type: 'metric-comparison',
        version: 1,
      },
    ],
  };

  it('normalizes datasets and views into versioned check-result metadata', () => {
    expect(visualizationMetadata(input)).toEqual({
      visualization: {
        datasets: input.datasets,
        schemaVersion: 1,
        views: input.visualizations,
      },
    });
  });

  it('rejects a view that references a missing dataset', () => {
    expect(() =>
      visualizationMetadata({
        ...input,
        visualizations: [{ ...input.visualizations[0], dataset: 'missing' }],
      }),
    ).toThrow('dataset');
  });

  it('rejects cells outside the declared field schema', () => {
    expect(() =>
      visualizationMetadata({
        ...input,
        datasets: [{ ...input.datasets[0], rows: [{ unexpected: 1 }] }],
      }),
    ).toThrow('does not match');
  });

  it('accepts grouped bar charts and SOTA table highlights', () => {
    expect(
      visualizationMetadata({
        ...input,
        visualizations: [
          {
            dataset: 'metrics',
            encoding: { category: 'name', series: [{ field: 'before' }] },
            id: 'scores',
            type: 'bar-chart',
            version: 1,
          },
          {
            dataset: 'metrics',
            encoding: { highlights: [{ field: 'after', mode: 'min' }] },
            id: 'score-table',
            type: 'table',
            version: 1,
          },
        ],
      })?.visualization?.views.map((view) => view.type),
    ).toEqual(['bar-chart', 'table']);
  });

  it.each([
    ['bar-chart', {}],
    ['heatmap', { x: 'name', y: 'before' }],
    ['line-chart', { series: [], x: 'name' }],
    ['metric-comparison', { after: 'after', before: 'before' }],
    ['scatter-plot', { x: 'before', y: 'missing' }],
    ['table', { columns: ['missing'] }],
  ])('rejects malformed %s encodings', (type, encoding) => {
    expect(() =>
      visualizationMetadata({
        ...input,
        visualizations: [{ dataset: 'metrics', encoding, id: 'invalid-view', type, version: 1 }],
      }),
    ).toThrow();
  });

  it('rejects duplicate dataset field keys', () => {
    expect(() =>
      visualizationMetadata({
        ...input,
        datasets: [
          {
            ...input.datasets[0],
            fields: [
              { key: 'name', type: 'string' },
              { key: 'name', type: 'number' },
            ],
          },
        ],
      }),
    ).toThrow('field keys must be unique');
  });
});

describe('evidenceTypeForFile — markdown evidence', () => {
  it('maps .md / .markdown to the markdown medium, keeping .txt as text', () => {
    expect(evidenceTypeForFile('assets/root-cause.md')).toBe('markdown');
    expect(evidenceTypeForFile('assets/root-cause.markdown')).toBe('markdown');
    expect(evidenceTypeForFile('assets/root-cause.txt')).toBe('text');
  });

  it('types an audio clip as audio, not the binary-blob-as-text fallback', () => {
    // Before `audio` existed these fell through to `text`, so a TTS deliverable
    // published as an unreadable, unplayable artifact.
    expect(evidenceTypeForFile('assets/tts-zh.mp3')).toBe('audio');
    expect(evidenceTypeForFile('assets/reply.WAV')).toBe('audio');
    expect(evidenceTypeForFile('assets/voice.m4a')).toBe('audio');
    expect(evidenceTypeForFile('assets/tone.opus')).toBe('audio');
    // .webm stays video — the container is overwhelmingly used for screen clips.
    expect(evidenceTypeForFile('assets/flow.webm')).toBe('video');
  });

  it('inlines a small markdown file as content instead of uploading it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lh-evidence-'));
    const file = path.join(dir, 'root-cause.md');
    writeFileSync(file, '### 根因证据\n\n- `heteroSessionId` 未透传');

    try {
      expect(inlineTextEvidenceForFile(file, evidenceTypeForFile(file))).toBe(
        '### 根因证据\n\n- `heteroSessionId` 未透传',
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
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

describe('screenProgrammaticTestChecks', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('drops the repo test suites and static gates, keeping real acceptance checks', () => {
    const result = {
      cases: [
        { id: 'c1', name: '语音回复能在气泡里播放', status: 'pass' },
        { id: 'c2', name: '单元测试全部通过', status: 'pass' },
      ],
      plan: [
        { id: 'c1', title: '语音回复能在气泡里播放' },
        { id: 'c2', title: '单元测试全部通过' },
        { id: 'c3', method: 'bun run check --type', title: '类型检查无报错' },
      ],
    };

    const { droppedIds, droppedLabels } = screenProgrammaticTestChecks(result);

    expect([...droppedIds]).toEqual(['c2', 'c3']);
    expect(droppedLabels).toEqual(['c2 — 单元测试全部通过', 'c3 — 类型检查无报错']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('screens plan and cases together so a dropped item never orphans its pair', () => {
    // The plan item names the gate; the case is titled loosely. Screening only
    // one side would leave the other behind as an "unplanned" row.
    const { droppedIds } = screenProgrammaticTestChecks({
      cases: [{ id: 'c1', name: 'all green' }],
      plan: [{ id: 'c1', title: 'vitest suite passes' }],
    });

    expect([...droppedIds]).toEqual(['c1']);
  });

  it('says nothing when the round has no programmatic-test checks', () => {
    const { droppedIds, droppedLabels } = screenProgrammaticTestChecks({
      plan: [{ id: '1', title: 'the reply streams token by token' }],
    });

    expect(droppedIds.size).toBe(0);
    expect(droppedLabels).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('omits the screened ids from the frozen plan', () => {
    const result = {
      plan: [
        { id: 'c1', title: 'the reply streams token by token' },
        { id: 'c2', title: 'unit tests pass' },
      ],
    };
    const { droppedIds } = screenProgrammaticTestChecks(result);

    expect(planFromResult(result, droppedIds)!.map((item) => item.id)).toEqual(['c1']);
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
      getBundle: { query: vi.fn() },
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

  it('keeps position-based fallback ids stable when screening drops an earlier case', async () => {
    // Regression (codex review): the survivors used to be re-enumerated after
    // the programmatic-test screen, so dropping an id-less first case shifted
    // every later fallback id (`case-2` ingested as `case-1`) — orphaning the
    // results from their plan items in the immutable round.
    const verify = mockTrpcClient.verify as Record<string, any>;
    verify.ingestResult = { mutate: vi.fn().mockResolvedValue({ id: 'result-1' }) };
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [
          { name: '单元测试全部通过', status: 'pass' },
          { name: '回复在气泡中渲染', status: 'pass' },
          { name: '失败态可重试', status: 'pass' },
        ],
        plan: [
          { id: 'case-2', title: '回复在气泡中渲染' },
          { id: 'case-3', title: '失败态可重试' },
        ],
        title: 'fallback id screening',
      }),
    );

    await run(['ingest-report', dir, '--json']);

    const ingested = verify.ingestResult.mutate.mock.calls.map(
      ([input]: [{ checkItemId: string }]) => input.checkItemId,
    );
    expect(ingested).toEqual(['case-2', 'case-3']);
  });

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

  it('creates a standalone acceptance when an external project has no operation or subject', async () => {
    delete process.env.LOBEHUB_TOPIC_ID;
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({ cases: [], title: 'External delivery verification' }),
    );

    await run(['ingest-report', dir, '--json']);

    expect(mockTrpcClient.acceptance.ensure.mutate).toHaveBeenCalledWith({
      requirement: undefined,
      subjectId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      subjectType: 'standalone',
      title: 'External delivery verification',
    });
    expect(mockTrpcClient.acceptance.attachRun.mutate).toHaveBeenCalledWith({
      acceptanceId: 'acceptance-1',
      verifyRunId: 'run-new',
    });
  });

  it('appends a re-verification round directly to an existing acceptance', async () => {
    mockTrpcClient.acceptance.getBundle.query.mockResolvedValue({
      acceptance: {
        id: 'acceptance-existing',
        status: 'delivered',
        subjectId: 'standalone-subject',
        subjectType: 'standalone',
      },
    });

    await run(['ingest-report', dir, '--acceptance', 'acceptance-existing', '--json']);

    expect(mockTrpcClient.acceptance.getBundle.query).toHaveBeenCalledWith({
      id: 'acceptance-existing',
    });
    expect(mockTrpcClient.acceptance.ensure.mutate).not.toHaveBeenCalled();
    expect(mockTrpcClient.acceptance.attachRun.mutate).toHaveBeenCalledWith({
      acceptanceId: 'acceptance-existing',
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

  it('prices a recorded interaction trace with the platform counting logic', async () => {
    const verify = mockTrpcClient.verify as Record<string, any>;
    const atom = (operators: Record<string, number>) =>
      JSON.stringify({
        klm: { category: 'action', operators },
        phase: { id: 'login', label: 'Login' },
        schema: 'lobehub.agentBrowserKlmTrace@1',
      });
    writeFileSync(
      path.join(dir, 'interaction-trace.jsonl'),
      `${atom({ K: 1, P: 1 })}\n${atom({ R_ms: 2000 })}\n`,
    );

    await run(['ingest-report', dir, '--json']);

    expect(verify.createRun.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          interactionCost: expect.objectContaining({
            activeSeconds: 1.3,
            model: 'goms-klm@lobe-v1',
            sourceTrace: 'interaction-trace.jsonl',
            totalSeconds: 3.3,
          }),
        }),
      }),
    );
  });

  it('publishes without interaction cost when no trace was recorded', async () => {
    // A CLI-only round, or a machine with no agent-browser, records no trace.
    // Interaction cost is an optional overlay: absent must stay silent, never a
    // warning and never a 0s measurement rendered as a real one.
    const verify = mockTrpcClient.verify as Record<string, any>;
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

    await run(['ingest-report', dir, '--json']);

    const metadata = verify.createRun.mutate.mock.calls[0][0].metadata;
    expect(metadata?.interactionCost).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('interaction'));
    warnSpy.mockRestore();
  });

  it('still prices the trace when result.json scaffolds interactionCost as null', async () => {
    // Regression (found by running the flow): `report-init.sh` writes
    // `"interactionCost": null` to document the field. Treating key presence as
    // an explicit summary made the project's own scaffolder silently suppress
    // pricing on every traced round it created.
    const verify = mockTrpcClient.verify as Record<string, any>;
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({ cases: [], interactionCost: null }),
    );
    writeFileSync(
      path.join(dir, 'interaction-trace.jsonl'),
      `${JSON.stringify({
        klm: { category: 'action', operators: { P: 1 } },
        schema: 'lobehub.agentBrowserKlmTrace@1',
      })}\n`,
    );

    await run(['ingest-report', dir, '--json']);

    expect(verify.createRun.mutate.mock.calls[0][0].metadata.interactionCost).toMatchObject({
      totalSeconds: 1.1,
    });
  });

  it('keeps an explicit result.json interactionCost over the trace', async () => {
    const verify = mockTrpcClient.verify as Record<string, any>;
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [],
        interactionCost: {
          activeSeconds: 9,
          model: 'hand-written',
          operators: {},
          totalSeconds: 9,
          waitSeconds: 0,
        },
      }),
    );
    writeFileSync(
      path.join(dir, 'interaction-trace.jsonl'),
      `${JSON.stringify({ klm: { operators: { P: 1 } } })}\n`,
    );

    await run(['ingest-report', dir, '--json']);

    expect(verify.createRun.mutate.mock.calls[0][0].metadata.interactionCost.model).toBe(
      'hand-written',
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

  it('validates every visualization before creating or attaching an immutable round', async () => {
    const verify = mockTrpcClient.verify as Record<string, any>;
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [
          {
            datasets: [
              {
                fields: [{ key: 'score', type: 'number' }],
                id: 'scores',
                rows: [{ score: 1 }],
              },
            ],
            id: 'broken-chart',
            visualizations: [
              {
                dataset: 'scores',
                encoding: {},
                id: 'chart',
                type: 'bar-chart',
                version: 1,
              },
            ],
          },
        ],
      }),
    );

    await expect(run(['ingest-report', dir, '--json'])).rejects.toThrow(
      'case broken-chart: visualizations[0].encoding.category',
    );
    expect(verify.createRun.mutate).not.toHaveBeenCalled();
    expect(mockTrpcClient.acceptance.ensure.mutate).not.toHaveBeenCalled();
    expect(mockTrpcClient.acceptance.attachRun.mutate).not.toHaveBeenCalled();
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

  it('with --open prints only acceptance links, the round snapshot via ?r=', async () => {
    // The acceptance page is the sole user-facing link; the round's fixed
    // snapshot is the same URL with `?r=<roundIndex>` — never a /verify link.
    mockTrpcClient.acceptance.attachRun.mutate = vi.fn().mockResolvedValue({ roundIndex: 3 });

    await run(['ingest-report', dir, '--open']);

    const lines = consoleSpy.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('/acceptance/acceptance-1'))).toBe(true);
    expect(lines.some((line) => line.includes('/acceptance/acceptance-1?r=3'))).toBe(true);
    expect(lines.some((line) => line.includes('/verify/'))).toBe(false);
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

  it('reads the documented `status` field, same as the per-case ingest', () => {
    // Regression: `status` was skipped here while the per-case ingest reads
    // `result ?? status ?? verdict`, so an all-pass report written with the
    // documented field derived `uncertain` whenever this fallback ran (e.g.
    // after the programmatic-test screen recounts the summary).
    expect(deriveReportVerdict([{ status: 'pass' }, { status: 'pass' }])).toBe('passed');
    expect(deriveReportVerdict([{ status: 'pass' }, { status: 'fail' }])).toBe('failed');
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

describe('lh acceptance — canonical run tree', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    (mockTrpcClient.verify as Record<string, any>).submitCheckEvidence = {
      mutate: vi.fn().mockResolvedValue({
        checkResult: { id: 'result_1', verifyRunId: 'run_1' },
        evidence: [{ id: 'evidence_1' }],
      }),
    };
  });
  afterEach(() => consoleSpy.mockRestore());

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    // First-class `lh acceptance …` — the run subtree only hangs off this,
    // never off the deprecated `lh verify acceptance` alias.
    registerAcceptanceCommands(program);
    await program.parseAsync(['node', 'lh', 'acceptance', ...args]);
  };

  it('routes `acceptance run delete` to the same deleteRun mutation', async () => {
    mockTrpcClient.verify.deleteRun.mutate.mockReset().mockResolvedValue({ id: 'run_1' });
    await run(['run', 'delete', 'run_1', '--yes']);
    expect(mockTrpcClient.verify.deleteRun.mutate).toHaveBeenCalledWith({ verifyRunId: 'run_1' });
  });

  it('prints the full verification report URL after submitting evidence', async () => {
    await run([
      'run',
      'result',
      'submit',
      '--operation',
      'op_1',
      '--item',
      'check_1',
      '--type',
      'text',
      '--content',
      'passed',
    ]);

    const lines = consoleSpy.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain('report: https://app.lobehub.com/verify/run_1');
  });

  it('includes the verification report URL in JSON output', async () => {
    await run([
      'run',
      'result',
      'submit',
      '--operation',
      'op_1',
      '--item',
      'check_1',
      '--type',
      'text',
      '--content',
      'passed',
      '--json',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls.map((call) => String(call[0])).join(''));
    expect(output.url).toBe('https://app.lobehub.com/verify/run_1');
  });

  it('exposes `acceptance install` defaulting to the acceptance skill', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'acceptance-install-'));
    mockTrpcClient.verify.getSkillBundle.query.mockReset().mockResolvedValue({
      content: '# Acceptance SKILL',
      files: {},
      identifier: 'acceptance',
      name: 'acceptance',
    });
    await run(['install', '--dir', dir]);
    expect(mockTrpcClient.verify.getSkillBundle.query).toHaveBeenCalledWith({
      identifier: 'acceptance',
    });
    expect(existsSync(path.join(dir, '.agents', 'skills', 'acceptance', 'SKILL.md'))).toBe(true);
    rmSync(dir, { force: true, recursive: true });
  });

  it('reports the installed version and leaves it in the SKILL.md on disk', async () => {
    // The version is what a later install compares against, so it has to survive
    // in two places: the JSON result, and the frontmatter of the materialized
    // file (the copy a builder actually reads).
    const dir = mkdtempSync(path.join(tmpdir(), 'acceptance-version-'));
    mockTrpcClient.verify.getSkillBundle.query.mockReset().mockResolvedValue({
      content: '---\nname: acceptance\nversion: 1.0.0\n---\n\n# Acceptance SKILL',
      files: {},
      identifier: 'acceptance',
      name: 'acceptance',
      version: '1.0.0',
    });

    await run(['install', '--dir', dir, '--json']);

    const printed = JSON.parse(consoleSpy.mock.calls.at(-1)![0] as string);
    expect(printed.version).toBe('1.0.0');
    expect(
      readFileSync(path.join(dir, '.agents', 'skills', 'acceptance', 'SKILL.md'), 'utf8'),
    ).toContain('version: 1.0.0');
    rmSync(dir, { force: true, recursive: true });
  });

  it('removes stale materialized resources on `acceptance update`', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'acceptance-update-'));
    mockTrpcClient.verify.getSkillBundle.query.mockReset().mockResolvedValueOnce({
      content: '# Acceptance SKILL',
      files: {
        'references/auth.md': '# Mixed auth',
        'references/recording.md': '# Mixed recording',
      },
      identifier: 'acceptance',
      name: 'acceptance',
    });
    await run(['install', '--dir', dir]);

    mockTrpcClient.verify.getSkillBundle.query.mockResolvedValueOnce({
      content: '# Acceptance SKILL v2',
      files: {
        'references/auth-web.md': '# Web auth',
        'references/recording-cdp.md': '# CDP recording',
      },
      identifier: 'acceptance',
      name: 'acceptance',
    });
    await run(['update', '--dir', dir]);

    const skillDir = path.join(dir, '.agents', 'skills', 'acceptance');
    expect(existsSync(path.join(skillDir, 'references', 'auth.md'))).toBe(false);
    expect(existsSync(path.join(skillDir, 'references', 'recording.md'))).toBe(false);
    expect(existsSync(path.join(skillDir, 'references', 'auth-web.md'))).toBe(true);
    expect(existsSync(path.join(skillDir, 'references', 'recording-cdp.md'))).toBe(true);
    rmSync(dir, { force: true, recursive: true });
  });

  it('does NOT attach the run subtree to the deprecated `verify acceptance` alias', async () => {
    const program = new Command();
    program.exitOverride();
    registerAcceptanceCommands(program, { deprecated: true });
    const acceptance = program.commands.find((c) => c.name() === 'acceptance');
    const hasRun = acceptance?.commands.some((c) => c.name() === 'run');
    expect(hasRun).toBe(false);
  });
});

describe('formatAnnotationRegion', () => {
  const rect = { height: 0.03, width: 0.12, x: 0.31, y: 0.24 };

  it('names the evidence the region was drawn on and where on it', () => {
    expect(
      formatAnnotationRegion(
        { comment: 'too light', evidenceId: 'ev-1', rect },
        new Map([['ev-1', 'c11-profile-editing.png']]),
      ),
    ).toBe('c11-profile-editing.png @ 31%,24% · 12%×3%');
  });

  // Without the filename a reader still cannot tell WHICH screenshot was circled,
  // so the raw id is better than dropping the reference entirely.
  it('falls back to the raw evidence id when the label is unknown', () => {
    expect(formatAnnotationRegion({ evidenceId: 'ev-9', rect })).toBe('ev-9 @ 31%,24% · 12%×3%');
  });

  it('renders the position alone when the annotation names no evidence', () => {
    expect(formatAnnotationRegion({ rect })).toBe('31%,24% · 12%×3%');
  });

  it('renders the evidence alone when the rect is absent', () => {
    expect(formatAnnotationRegion({ evidenceId: 'ev-1' }, new Map([['ev-1', 'shot.png']]))).toBe(
      'shot.png',
    );
  });

  // Reviews made before regions existed carry only a comment — printing an empty
  // "└" line under every one of them would be pure noise.
  it('returns undefined when there is no location at all', () => {
    expect(formatAnnotationRegion({ comment: 'just a note' })).toBeUndefined();
    expect(formatAnnotationRegion({ rect: { x: 0.1 } })).toBeUndefined();
  });
});
