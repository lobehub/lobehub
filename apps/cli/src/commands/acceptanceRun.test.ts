import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../api/client';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';
import { uploadLocalFile } from '../utils/uploadLocalFile';
import { attachAcceptanceRunCommands } from './acceptanceRun';

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../settings', () => ({ resolveServerUrl: vi.fn() }));
vi.mock('../utils/uploadLocalFile', () => ({ uploadLocalFile: vi.fn() }));

describe('acceptance publication with missing evidence', () => {
  const client = {
    acceptance: {
      attachRun: { mutate: vi.fn() },
      ensure: { mutate: vi.fn() },
    },
    verify: {
      createRun: { mutate: vi.fn() },
      ingestResult: { mutate: vi.fn() },
      uploadEvidence: { mutate: vi.fn() },
      upsertReport: { mutate: vi.fn() },
    },
  };
  let dir: string;
  let printed: string[];
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.resetAllMocks();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    printed = [];
    vi.spyOn(console, 'log').mockImplementation((line) => printed.push(String(line)));
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.mocked(resolveServerUrl).mockReturnValue('https://app.lobehub.com');
    vi.mocked(getTrpcClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getTrpcClient>>,
    );
    vi.mocked(uploadLocalFile).mockResolvedValue({ id: 'file-1', url: 'https://files.test/1' });
    client.acceptance.ensure.mutate.mockResolvedValue({ id: 'acceptance-1' });
    client.acceptance.attachRun.mutate.mockResolvedValue({ id: 'run-1', roundIndex: 2 });
    client.verify.createRun.mutate.mockResolvedValue({ id: 'run-1' });
    client.verify.ingestResult.mutate.mockImplementation(async (input) => ({
      id: `result-${input.checkItemId}`,
    }));
    client.verify.uploadEvidence.mutate.mockResolvedValue({ id: 'evidence-1' });
    dir = await mkdtemp(path.join(tmpdir(), 'lh-evidence-'));
    await writeFile(path.join(dir, "screen's shot.png"), 'image fixture');
    await writeFile(path.join(dir, 'output.txt'), 'Observed the expected response.');
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    await rm(dir, { force: true, recursive: true });
  });

  const run = async (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    attachAcceptanceRunCommands(program.command('acceptance'));
    await program.parseAsync(['node', 'lh', 'acceptance', 'run', ...args]);
  };

  const report = async (requiredEvidence: string[], evidence: string[], verdict = 'passed') => {
    await writeFile(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [{ evidence, id: 'screen', name: '用户能看到处理结果', status: verdict }],
        plan: [{ id: 'screen', requiredEvidence, title: '用户能看到处理结果' }],
        summary: { passed: 1, total: 1, verdict },
        title: '处理结果展示',
      }),
    );
  };

  const result = () => JSON.parse(printed.at(-1)!);
  const finalCheck = () => client.verify.ingestResult.mutate.mock.calls.at(-1)![0];
  const finalReport = () => client.verify.upsertReport.mutate.mock.calls.at(-1)![0];

  it('publishes partial JSON and downgrades a pass when quota blocks required screenshots', async () => {
    vi.mocked(uploadLocalFile).mockRejectedValue(new Error('storage_block:upgrade_required'));
    await report(['screenshot', 'text'], ["screen's shot.png", 'output.txt']);
    const original = await readFile(path.join(dir, 'result.json'), 'utf8');

    await run('ingest', dir, '--json');

    expect(process.exitCode).toBe(1);
    expect(result()).toMatchObject({
      acceptanceUrl: 'https://app.lobehub.com/acceptance/acceptance-1',
      evidence: 1,
      failedEvidence: [
        { checkItemId: 'screen', checkResultId: 'result-screen', reason: 'storage_quota' },
      ],
      inlined: 1,
      missingEvidence: [{ checkItemId: 'screen', types: ['screenshot'] }],
      publicationStatus: 'partial',
      recovery: {
        cleanupUrl: 'https://lobehub.com/acceptance',
        reason: 'storage_quota',
        upgradeUrl: 'https://lobehub.com/settings/plans',
      },
      roundUrl: 'https://app.lobehub.com/acceptance/acceptance-1?r=2',
    });
    expect(result().failedEvidence[0].retryCommand).toContain('evidence upload');
    expect(finalCheck()).toMatchObject({
      verdict: 'uncertain',
      toulmin: { limitation: expect.stringContaining('screenshot') },
    });
    expect(finalReport()).toMatchObject({
      passedChecks: 0,
      totalChecks: 1,
      uncertainChecks: 1,
      verdict: 'uncertain',
    });
    expect(await readFile(path.join(dir, 'result.json'), 'utf8')).toBe(original);
  });

  it('does not downgrade a pass when only an optional medium failed', async () => {
    vi.mocked(uploadLocalFile).mockRejectedValue(new Error('storage_block:upgrade_required'));
    await report(['text'], ['output.txt', "screen's shot.png"]);

    await run('ingest', dir, '--json');

    expect(process.exitCode).toBe(1);
    expect(result()).toMatchObject({ missingEvidence: [], publicationStatus: 'partial' });
    expect(finalCheck().verdict).toBe('passed');
    expect(finalReport().verdict).toBe('passed');
  });

  it('counts only attached evidence, but accepts another successful file of the same required type', async () => {
    await writeFile(path.join(dir, 'second.png'), 'another image');
    vi.mocked(uploadLocalFile).mockRejectedValueOnce(new Error('storage_block:upgrade_required'));
    await report(['screenshot'], ["screen's shot.png", 'second.png']);

    await run('ingest', dir, '--json');

    expect(result()).toMatchObject({
      evidence: 1,
      missingEvidence: [],
      publicationStatus: 'partial',
    });
    expect(finalCheck().verdict).toBe('passed');
  });

  it.each(['failed', 'uncertain'])(
    'preserves an existing %s verdict with missing evidence',
    async (verdict) => {
      await report(['screenshot'], ['missing.png'], verdict);

      await run('ingest', dir, '--json');

      expect(result().failedEvidence[0].reason).toBe('file_missing');
      expect(finalCheck().verdict).toBe(verdict);
      expect(finalReport().verdict).toBe(verdict);
      expect(process.exitCode).toBe(1);
    },
  );

  it('reports missing required evidence even when no upload was attempted', async () => {
    await report(['screenshot'], []);

    await run('ingest', dir, '--json');

    expect(result()).toMatchObject({
      failedEvidence: [],
      missingEvidence: [{ checkItemId: 'screen', types: ['screenshot'] }],
      publicationStatus: 'partial',
    });
    expect(finalReport().verdict).toBe('uncertain');
    expect(process.exitCode).toBe(1);
  });

  it('prints the saved report link and recovery advice without --open', async () => {
    vi.mocked(uploadLocalFile).mockRejectedValue(new Error('storage_block:upgrade_required'));
    await report(['screenshot'], ["screen's shot.png"]);

    await run('ingest', dir);

    expect(printed.join('\n')).toContain('Partially published');
    expect(printed.join('\n')).toContain('https://app.lobehub.com/acceptance/acceptance-1?r=2');
    expect(printed.join('\n')).toContain('evidence upload');
    expect(printed.join('\n')).toContain('POSIX shell');
    expect(printed.join('\n')).toContain('retryArgs');
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('https://lobehub.com/acceptance'),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('https://lobehub.com/settings/plans'),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('permanently delete all rounds, reports, and evidence files'),
    );
    expect(process.exitCode).toBe(1);
  });

  it('uses the configured server without credentials for recovery links', async () => {
    vi.mocked(resolveServerUrl).mockReturnValue(
      'https://quota-user:quota%40password@lobe.example.test:8443/base',
    );
    vi.mocked(uploadLocalFile).mockRejectedValue(new Error('storage_block:upgrade_required'));
    await report(['screenshot'], ["screen's shot.png"]);

    await run('ingest', dir, '--json');

    expect(result().recovery).toMatchObject({
      cleanupUrl: 'https://lobe.example.test:8443/acceptance',
      upgradeUrl: 'https://lobe.example.test:8443/settings/plans',
    });
    expect(result().recovery.message).toContain('https://lobe.example.test:8443/acceptance');
    expect(result().recovery.message).toContain('https://lobe.example.test:8443/settings/plans');
    expect(JSON.stringify(result().recovery)).not.toMatch(
      /quota-user|quota%40password|quota@password/,
    );
    expect(log.warn).toHaveBeenCalledWith(result().recovery.message);
  });

  it.each([undefined, 'Upload failed: 503 Service Unavailable'])(
    'does not suggest storage recovery for a non-quota outcome: %s',
    async (error) => {
      if (error) vi.mocked(uploadLocalFile).mockRejectedValue(new Error(error));
      await report(['screenshot'], ["screen's shot.png"]);

      await run('ingest', dir, '--json');

      expect(result()).not.toHaveProperty('recovery');
      expect(result().publicationStatus).toBe(error ? 'partial' : 'complete');
      expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('/settings/plans'));
    },
  );

  describe.each([
    ['evidence', 'upload', '--check', 'result-screen'],
    ['result', 'submit', '--run', 'run-1', '--item', 'screen'],
  ])('atomic upload via %s %s', (...command) => {
    it.each([false, true])(
      'reports quota recovery (json=%s) without writing a result',
      async (json) => {
        vi.mocked(resolveServerUrl).mockReturnValue(
          'https://quota-user:quota%40password@app.lobehub.com',
        );
        vi.mocked(uploadLocalFile).mockRejectedValue(new Error('storage_block:upgrade_required'));

        await run(
          ...command,
          '--file',
          path.join(dir, "screen's shot.png"),
          '--type',
          'screenshot',
          '--desc',
          'The visible result',
          ...(json ? ['--json'] : []),
        );

        expect(process.exitCode).toBe(1);
        expect(client.verify.uploadEvidence.mutate).not.toHaveBeenCalled();
        expect(client.verify.ingestResult.mutate).not.toHaveBeenCalled();
        expect(client.verify.createRun.mutate).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(
          expect.stringContaining('https://lobehub.com/acceptance'),
        );
        expect(log.warn).toHaveBeenCalledWith(
          expect.stringContaining('https://lobehub.com/settings/plans'),
        );
        expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toMatch(
          /quota-user|quota%40password|quota@password/,
        );
        expect(printed.join('\n')).not.toMatch(/quota-user|quota%40password|quota@password/);
        if (json) {
          expect(result()).toMatchObject({
            error: 'storage_block:upgrade_required',
            recovery: {
              reason: 'storage_quota',
              cleanupUrl: 'https://lobehub.com/acceptance',
              upgradeUrl: 'https://lobehub.com/settings/plans',
            },
          });
        }
      },
    );

    it('preserves non-quota errors without suggesting an upgrade', async () => {
      const error = new Error('Upload failed: 503 Service Unavailable');
      vi.mocked(uploadLocalFile).mockRejectedValue(error);

      await expect(
        run(
          ...command,
          '--file',
          path.join(dir, "screen's shot.png"),
          '--type',
          'screenshot',
          '--desc',
          'The visible result',
          '--json',
        ),
      ).rejects.toBe(error);

      expect(printed).toEqual([]);
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  it.each(['passed', 'failed'])(
    'accounts for an unexecuted check alongside a %s case',
    async (verdict) => {
      await writeFile(
        path.join(dir, 'result.json'),
        JSON.stringify({
          cases: [{ id: 'response', name: '收到回复', status: verdict, evidence: ['output.txt'] }],
          plan: [
            { id: 'response', title: '收到回复', requiredEvidence: ['text'] },
            {
              id: 'screen',
              title: '画面展示',
              requiredEvidence: ['screenshot', 'text', 'screenshot'],
            },
          ],
          summary: { passed: 2, total: 2, verdict: 'passed' },
        }),
      );

      await run('ingest', dir, '--json');

      expect(result()).toMatchObject({
        cases: 1,
        missingEvidence: [{ checkItemId: 'screen', types: ['screenshot', 'text'] }],
        publicationStatus: 'partial',
        unexecuted: ['screen'],
      });
      expect(finalReport()).toMatchObject({
        failedChecks: verdict === 'failed' ? 1 : 0,
        passedChecks: verdict === 'passed' ? 1 : 0,
        totalChecks: 2,
        uncertainChecks: 1,
        verdict: verdict === 'failed' ? 'failed' : 'uncertain',
      });
      expect(client.verify.ingestResult.mutate).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(1);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('new round'));
    },
  );

  it('keeps an entirely unexecuted required-evidence plan uncertain', async () => {
    await writeFile(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [],
        plan: [{ id: 'screen', title: '画面展示', requiredEvidence: ['screenshot'] }],
        summary: { passed: 1, total: 1, verdict: 'passed' },
      }),
    );

    await run('ingest', dir, '--json');

    expect(result()).toMatchObject({ publicationStatus: 'partial', unexecuted: ['screen'] });
    expect(finalReport()).toMatchObject({
      passedChecks: 0,
      totalChecks: 1,
      uncertainChecks: 1,
      verdict: 'uncertain',
    });
    expect(client.verify.ingestResult.mutate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('accounts for draft-only checks and incoming checks using the folded plan', async () => {
    client.acceptance.attachRun.mutate.mockResolvedValue({
      id: 'draft-run',
      plan: [
        {
          id: 'draft-response',
          verifierConfig: { requiredEvidence: [{ type: 'text' }] },
        },
        {
          id: 'draft-screen',
          verifierConfig: { requiredEvidence: [{ type: 'screenshot' }] },
        },
        { id: 'response', verifierConfig: { requiredEvidence: [{ type: 'text' }] } },
      ],
      roundIndex: 1,
    });
    await writeFile(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [
          { evidence: ['output.txt'], id: 'draft-response', name: '草稿回复', status: 'passed' },
          { evidence: ['output.txt'], id: 'response', name: '收到回复', status: 'passed' },
        ],
        plan: [{ id: 'response', requiredEvidence: ['text'], title: '收到回复' }],
        summary: { passed: 2, total: 2, verdict: 'passed' },
      }),
    );

    await run('ingest', dir, '--json');

    expect(result()).toMatchObject({
      cases: 2,
      missingEvidence: [{ checkItemId: 'draft-screen', types: ['screenshot'] }],
      planItems: 3,
      publicationStatus: 'partial',
      unexecuted: ['draft-screen'],
      unplanned: [],
      verifyRunId: 'draft-run',
    });
    expect(finalReport()).toMatchObject({
      failedChecks: 0,
      passedChecks: 2,
      totalChecks: 3,
      uncertainChecks: 1,
      verdict: 'uncertain',
      verifyRunId: 'draft-run',
    });
    expect(
      client.verify.ingestResult.mutate.mock.calls.map(([input]) => input.checkItemId),
    ).toEqual(['draft-response', 'response']);
    expect(process.exitCode).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('new round'));
  });

  it.each([false, true])(
    'uses the draft evidence requirement for a shared check (screenshot present: %s)',
    async (hasScreenshot) => {
      client.acceptance.attachRun.mutate.mockResolvedValue({
        id: 'draft-run',
        plan: [{ id: 'screen', verifierConfig: { requiredEvidence: [{ type: 'screenshot' }] } }],
        roundIndex: 1,
      });
      await report(['text'], hasScreenshot ? ["screen's shot.png"] : ['output.txt']);

      await run('ingest', dir, '--json');

      expect(result()).toMatchObject({
        missingEvidence: hasScreenshot ? [] : [{ checkItemId: 'screen', types: ['screenshot'] }],
        publicationStatus: hasScreenshot ? 'complete' : 'partial',
        unexecuted: [],
        unplanned: [],
      });
      expect(finalCheck()).toMatchObject({
        verdict: hasScreenshot ? 'passed' : 'uncertain',
        verifyRunId: 'draft-run',
      });
      expect(finalReport()).toMatchObject({
        passedChecks: hasScreenshot ? 1 : 0,
        totalChecks: 1,
        uncertainChecks: hasScreenshot ? undefined : 1,
        verdict: hasScreenshot ? 'passed' : 'uncertain',
      });
      expect(process.exitCode).toBe(hasScreenshot ? undefined : 1);
    },
  );

  it('exposes shell-independent upload arguments without escaping path or description', async () => {
    const description = `User's "input" $HOME %TEMP% & | \`literal\``;
    await writeFile(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [
          {
            id: 'screen',
            name: '画面展示',
            status: 'passed',
            evidence: [{ path: "screen's shot.png", description }],
          },
        ],
        plan: [{ id: 'screen', title: '画面展示', requiredEvidence: ['screenshot'] }],
      }),
    );
    vi.mocked(uploadLocalFile).mockRejectedValueOnce(new Error('storage_block:upgrade_required'));
    await run('ingest', dir, '--json');
    const failure = result().failedEvidence[0];
    expect(failure.retryCommandShell).toBe('posix');
    expect(failure.retryArgs).toEqual([
      'acceptance',
      'run',
      'evidence',
      'upload',
      '--check',
      'result-screen',
      '--type',
      'screenshot',
      '--file',
      path.join(dir, "screen's shot.png"),
      '--desc',
      description,
    ]);

    const program = new Command();
    attachAcceptanceRunCommands(program.command('acceptance'));
    await program.parseAsync(['node', 'lh', ...failure.retryArgs]);
    expect(client.verify.uploadEvidence.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ description, fileId: 'file-1' }),
    );
    expect(uploadLocalFile).toHaveBeenLastCalledWith(client, path.join(dir, "screen's shot.png"));
  });

  it('finishes a complete publication with no failure exit code', async () => {
    await report(['screenshot', 'text'], ["screen's shot.png", 'output.txt']);

    await run('ingest', dir, '--json');

    expect(result()).toMatchObject({
      evidence: 2,
      failedEvidence: [],
      inlined: 1,
      missingEvidence: [],
      publicationStatus: 'complete',
    });
    expect(finalCheck().verdict).toBe('passed');
    expect(process.exitCode).toBeUndefined();
  });

  it('retries only the failed attachment, reusing its file and preserving its caption and comparison', async () => {
    const description = "Before: user's input $(printf should-not-expand)";
    const comparison = { id: 'input', role: 'before' };
    await writeFile(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [
          {
            evidence: [{ comparison, description, path: "screen's shot.png" }, 'output.txt'],
            id: 'screen',
            name: '用户能看到处理结果',
            status: 'passed',
          },
        ],
        plan: [
          { id: 'screen', requiredEvidence: ['screenshot', 'text'], title: '用户能看到处理结果' },
        ],
      }),
    );
    client.verify.uploadEvidence.mutate.mockRejectedValueOnce(new Error('attachment unavailable'));
    await run('ingest', dir, '--json');
    const failure = result().failedEvidence[0];
    expect(failure).toMatchObject({ fileId: 'file-1', reason: 'upload_failed' });
    expect(failure.retryArgs).toEqual([
      'acceptance',
      'run',
      'evidence',
      'upload',
      '--check',
      'result-screen',
      '--type',
      'screenshot',
      '--file-id',
      'file-1',
      '--desc',
      description,
      '--metadata',
      JSON.stringify({ comparison }),
    ]);
    expect(finalCheck().verdict).toBe('uncertain');
    const originalReport = finalReport();
    const checkWrites = client.verify.ingestResult.mutate.mock.calls.length;

    // Parse with a real POSIX shell: spaces, quotes and command substitutions
    // in a caption must survive verbatim rather than changing the command.
    const { stdout } = await promisify(execFile)('sh', [
      '-c',
      failure.retryCommand.replace('lh acceptance run evidence upload', 'printf "%s\\0"'),
    ]);
    await run('evidence', 'upload', ...stdout.split('\0').filter(Boolean));

    expect(uploadLocalFile).toHaveBeenCalledTimes(1);
    expect(client.verify.createRun.mutate).toHaveBeenCalledTimes(1);
    expect(client.verify.ingestResult.mutate).toHaveBeenCalledTimes(checkWrites);
    expect(client.verify.upsertReport.mutate).toHaveBeenCalledTimes(1);
    expect(finalReport()).toEqual(originalReport);
    expect(client.verify.uploadEvidence.mutate.mock.calls.at(-1)![0]).toMatchObject({
      capturedBy: 'cli',
      checkResultId: 'result-screen',
      description,
      fileId: 'file-1',
      metadata: { comparison },
      type: 'screenshot',
    });
  });

  it('recounts mixed checks without converting an observed failure into uncertainty', async () => {
    vi.mocked(uploadLocalFile).mockRejectedValue(new Error('storage_block:upgrade_required'));
    await writeFile(
      path.join(dir, 'result.json'),
      JSON.stringify({
        cases: [
          { evidence: ["screen's shot.png"], id: 'screen', name: '画面展示', status: 'passed' },
          { evidence: ['output.txt'], id: 'response', name: '收到回复', status: 'passed' },
          { id: 'cancel', name: '取消操作', status: 'failed' },
        ],
        plan: [{ id: 'screen', requiredEvidence: ['screenshot'], title: '画面展示' }],
        summary: { failed: 1, passed: 2, total: 3, verdict: 'failed' },
      }),
    );

    await run('ingest', dir, '--json');

    expect(finalReport()).toMatchObject({
      failedChecks: 1,
      passedChecks: 1,
      totalChecks: 3,
      uncertainChecks: 1,
      verdict: 'failed',
    });
  });
});
