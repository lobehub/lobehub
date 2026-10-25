import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import { registerVerifyCommand } from '../deprecatedVerify';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    user: {
      getUserState: {
        query: vi.fn(async () => ({ settings: { general: { responseLanguage: 'en-US' } } })),
      },
    },
    verify: {
      createRubric: { mutate: vi.fn() },
      deleteRun: { mutate: vi.fn() },
      getRubric: { query: vi.fn() },
      updateRubric: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));

describe('verify ingest-report — every run is an immutable acceptance round', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('LOBEHUB_WORKSPACE_ID', '');
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    const verify = mockTrpcClient.verify as Record<string, any>;
    verify.createRun = { mutate: vi.fn().mockResolvedValue({ id: 'run-new' }) };
    verify.updateRun = { mutate: vi.fn() };
    verify.upsertReport = { mutate: vi.fn().mockResolvedValue({}) };
    mockTrpcClient.acceptance = {
      attachRun: { mutate: vi.fn() },
      ensure: { mutate: vi.fn().mockResolvedValue({ id: 'acceptance-1' }) },
      getBundle: { query: vi.fn().mockResolvedValue({}) },
    };
    mockTrpcClient.workspace = {
      getById: { query: vi.fn().mockResolvedValue({ id: 'workspace-1' }) },
    };

    dir = mkdtempSync(path.join(tmpdir(), 'lh-ingest-'));
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ cases: [] }));
    process.env.LOBEHUB_TOPIC_ID = 'topic-1';
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.unstubAllEnvs();
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
    // The ambient topic may be folded onto its Task by the server.
    expect(mockTrpcClient.acceptance.ensure.mutate).toHaveBeenCalledWith({
      foldTaskRunTopic: true,
      requirement: undefined,
      subjectId: 'topic-1',
      subjectType: 'topic',
    });
    expect(mockTrpcClient.acceptance.attachRun.mutate).toHaveBeenCalledWith({
      acceptanceId: 'acceptance-1',
      verifyRunId: 'run-new',
    });
  });

  it('keeps an explicit topic subject exact instead of folding it onto a Task', async () => {
    await run(['ingest-report', dir, '--subject', 'topic:topic-explicit', '--json']);

    expect(mockTrpcClient.acceptance.ensure.mutate).toHaveBeenCalledWith({
      requirement: undefined,
      subjectId: 'topic-explicit',
      subjectType: 'topic',
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

  it('reuses the asset when the acceptance row is keyed by criterion rather than plan item', async () => {
    mockTrpcClient.acceptance.getBundle.query.mockResolvedValue({
      acceptance: {
        id: 'acceptance-existing',
        status: 'delivered',
        subjectId: 'subject',
        subjectType: 'standalone',
      },
      checks: [
        { id: 'criterion-1', planItem: { id: 'stable-check', sourceCriterionId: 'criterion-1' } },
      ],
    });
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [{ id: 'stable-check', name: '输入区域可用', status: 'pass' }],
        plan: [
          {
            id: 'stable-check',
            title: '输入区域可用',
            verifier: 'agent',
            method: '打开输入区域',
            expected: '可以输入',
          },
        ],
      }),
    );
    await run(['ingest-report', dir, '--acceptance', 'acceptance-existing', '--json']);
    expect(mockTrpcClient.verify.createRun.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: [expect.objectContaining({ id: 'stable-check', sourceCriterionId: 'criterion-1' })],
      }),
    );
  });

  it('reuses criteria when the round reaches its acceptance through the subject', async () => {
    // Regression: only `--acceptance` read the existing checks, so re-ingesting
    // a topic's report minted fresh criteria and duplicated every check row.
    mockTrpcClient.acceptance.getBundle.query.mockResolvedValue({
      checks: [{ id: 'criterion-1', planItem: { id: '1', sourceCriterionId: 'criterion-1' } }],
    });
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [{ id: '1', name: '标题可编辑', status: 'pass' }],
        plan: [{ id: '1', title: '标题可编辑' }],
      }),
    );

    await run(['ingest-report', dir, '--json']);

    expect(mockTrpcClient.acceptance.getBundle.query).toHaveBeenCalledWith({ id: 'acceptance-1' });
    expect(mockTrpcClient.verify.createRun.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: [expect.objectContaining({ id: '1', sourceCriterionId: 'criterion-1' })],
      }),
    );
  });

  describe('identical re-ingest', () => {
    const publishedRound = (content: string) => ({
      report: { content, summary: '全部通过' },
      run: { id: 'run-r1', plan: [{ id: '1', title: '标题可编辑' }], roundIndex: 1 },
    });

    beforeEach(() => {
      (mockTrpcClient.verify as Record<string, any>).ingestResult = {
        mutate: vi.fn().mockResolvedValue({ id: 'result-1' }),
      };
      writeFileSync(path.join(dir, 'report.md'), '## 备注\n\n首次发布');
      writeFileSync(
        path.join(dir, 'result.json'),
        JSON.stringify({
          cases: [{ id: '1', name: '标题可编辑', status: 'pass' }],
          plan: [{ id: '1', title: '标题可编辑' }],
          summary: { conclusion: '全部通过', failed: 0, passed: 1, total: 1 },
        }),
      );
    });

    it('refuses to stack a round identical to the latest one', async () => {
      mockTrpcClient.acceptance.getBundle.query.mockResolvedValue({
        rounds: [publishedRound('## 备注\n\n首次发布')],
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit ${code}`);
      }) as never);

      try {
        await expect(run(['ingest-report', dir, '--json'])).rejects.toThrow('process.exit 1');
        expect(mockTrpcClient.verify.createRun.mutate).not.toHaveBeenCalled();
      } finally {
        exitSpy.mockRestore();
      }
    });

    it('publishes the next round once the report actually changed', async () => {
      mockTrpcClient.acceptance.getBundle.query.mockResolvedValue({
        rounds: [publishedRound('## 备注\n\n上一轮的报告')],
      });

      await run(['ingest-report', dir, '--json']);

      expect(mockTrpcClient.verify.createRun.mutate).toHaveBeenCalled();
    });
  });

  it.each([null, 'workspace-1'])(
    'appends a re-verification round when both scopes are %s',
    async (workspaceId) => {
      vi.stubEnv('LOBEHUB_WORKSPACE_ID', workspaceId ?? '');
      mockTrpcClient.acceptance.getBundle.query.mockResolvedValue({
        acceptance: {
          id: 'acceptance-existing',
          status: 'delivered',
          subjectId: 'standalone-subject',
          subjectType: 'standalone',
          workspaceId,
        },
      });

      await run(['ingest-report', dir, '--acceptance', 'acceptance-existing', '--json']);

      expect(mockTrpcClient.acceptance.ensure.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.acceptance.attachRun.mutate).toHaveBeenCalledWith({
        acceptanceId: 'acceptance-existing',
        verifyRunId: 'run-new',
      });
      expect(mockTrpcClient.verify.upsertReport.mutate).toHaveBeenCalled();
      expect(process.env.LOBEHUB_WORKSPACE_ID).toBe(workspaceId ?? '');
      if (!workspaceId) expect(mockTrpcClient.workspace.getById.query).not.toHaveBeenCalled();
    },
  );

  it.each([
    { effectiveWorkspace: null, name: 'revoked workspace membership' },
    { effectiveWorkspace: { id: 'workspace-other' }, name: 'a different server workspace' },
    { effectiveWorkspace: new Error('Workspace lookup unavailable'), name: 'a failed lookup' },
  ])('rejects $name before creating a run', async ({ effectiveWorkspace }) => {
    vi.stubEnv('LOBEHUB_WORKSPACE_ID', 'workspace-1');
    mockTrpcClient.acceptance.getBundle.query.mockResolvedValue({
      acceptance: {
        id: 'acceptance-existing',
        status: 'delivered',
        subjectId: 'standalone-subject',
        subjectType: 'standalone',
        workspaceId: 'workspace-1',
      },
    });
    const query = mockTrpcClient.workspace.getById.query;
    if (effectiveWorkspace instanceof Error) query.mockRejectedValue(effectiveWorkspace);
    else query.mockResolvedValue(effectiveWorkspace);

    await expect(
      run(['ingest-report', dir, '--acceptance', 'acceptance-existing', '--json']),
    ).rejects.toThrow(
      effectiveWorkspace instanceof Error ? effectiveWorkspace.message : 'No run was created.',
    );

    expect(mockTrpcClient.acceptance.ensure.mutate).not.toHaveBeenCalled();
    expect(mockTrpcClient.verify.createRun.mutate).not.toHaveBeenCalled();
    expect(mockTrpcClient.acceptance.attachRun.mutate).not.toHaveBeenCalled();
    expect(mockTrpcClient.verify.upsertReport.mutate).not.toHaveBeenCalled();
    expect(process.env.LOBEHUB_WORKSPACE_ID).toBe('workspace-1');
  });

  it.each([
    { current: '', hint: 'LOBEHUB_WORKSPACE_ID=workspace-target', target: 'workspace-target' },
    {
      current: 'workspace-current',
      hint: 'LOBEHUB_WORKSPACE_ID=workspace-target',
      target: 'workspace-target',
    },
    { current: 'workspace-current', hint: 'LOBEHUB_WORKSPACE_ID=personal', target: null },
  ])(
    'rejects scope $current → $target before any remote writes',
    async ({ current, target, hint }) => {
      vi.stubEnv('LOBEHUB_WORKSPACE_ID', current);
      mockTrpcClient.acceptance.getBundle.query.mockResolvedValue({
        acceptance: {
          id: 'acceptance-existing',
          status: 'delivered',
          subjectId: 'standalone-subject',
          subjectType: 'standalone',
          workspaceId: target,
        },
      });

      await expect(
        run(['ingest-report', dir, '--acceptance', 'acceptance-existing', '--json']),
      ).rejects.toThrow(hint);

      expect(mockTrpcClient.acceptance.ensure.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.verify.createRun.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.acceptance.attachRun.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.verify.upsertReport.mutate).not.toHaveBeenCalled();
      expect(process.env.LOBEHUB_WORKSPACE_ID).toBe(current);
    },
  );

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
