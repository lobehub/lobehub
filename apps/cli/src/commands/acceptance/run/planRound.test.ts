import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import { uploadLocalFile } from '../../../utils/uploadLocalFile';
import type * as VerifyHelpers from '../utils';
import { usePublicationHarness } from './testUtils';

vi.mock('../../../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../../../api/workspace', () => ({ resolveWorkspaceId: vi.fn() }));
vi.mock('../../../settings', () => ({ resolveServerUrl: vi.fn() }));
vi.mock('../../../utils/uploadLocalFile', () => ({ uploadLocalFile: vi.fn() }));
vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof VerifyHelpers>()),
  pullRequestFromBranch: vi.fn(),
}));

describe('lh acceptance run', () => {
  const h = usePublicationHarness();
  const { client, report, result, run } = h;

  describe('ingest into an operation that already owns a plan round', () => {
    const chapters = [
      { kind: 'step', label: 'Reload with listDevices held', t: 1.2 },
      { kind: 'check', note: 'First frame already shows the cached device', t: 2.4 },
    ];
    const frozenPlan = [
      {
        id: 'vci_reload',
        index: 0,
        required: true,
        title: '刷新后首屏直接显示设备',
        verifierConfig: { requiredEvidence: [{ type: 'video' }] },
        verifierType: 'llm',
      },
      {
        id: 'vci_code',
        index: 1,
        required: true,
        title: '持久化改用 replica',
        verifierConfig: {},
        verifierType: 'llm',
      },
    ];
    const writeRound = (cases: unknown[]) =>
      writeFile(
        path.join(h.dir, 'result.json'),
        JSON.stringify({
          cases,
          plan: [{ id: 'authored', title: 'ignored when the plan is frozen' }],
          summary: { verdict: 'passed' },
          title: '设备列表首屏',
        }),
      );

    beforeEach(async () => {
      client.verify.getVerifyState.query.mockResolvedValue({
        verifyPlan: frozenPlan,
        verifyPlanConfirmedAt: '2026-10-12T17:35:52.000Z',
        verifyRunId: 'plan-run',
      });
      client.verify.getRun.query.mockResolvedValue({
        acceptanceId: 'acceptance-task',
        id: 'plan-run',
        roundIndex: 1,
      });
      client.verify.submitCheckEvidence.mutate.mockImplementation(async (input) => ({
        checkResult: { id: `result-${input.checkItemId}`, verifyRunId: 'plan-run' },
        evidence: [],
      }));
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`);
      }) as never);
      vi.spyOn(log, 'error').mockImplementation(() => {});
      await writeFile(path.join(h.dir, 'report.md'), '# builder narrative');
      await writeFile(path.join(h.dir, 'proposal.md'), '刷新后设备芯片首帧即显示。');
    });

    it('publishes cases and chaptered videos into the plan round without creating a round or judging it', async () => {
      await writeRound([
        {
          evidence: [{ chapters, description: 'warm reload', path: 'scroll.mp4' }],
          id: 'vci_reload',
          observation: 'device chip renders on the first frame',
          status: 'passed',
        },
        { evidence: ['output.txt'], id: 'vci_code', status: 'passed' },
      ]);

      await run('ingest', h.dir, '--operation', 'op-task', '--json');

      expect(client.verify.createRun.mutate).not.toHaveBeenCalled();
      expect(client.acceptance.attachRun.mutate).not.toHaveBeenCalled();
      expect(client.acceptance.ensure.mutate).not.toHaveBeenCalled();
      expect(client.verify.ingestResult.mutate).not.toHaveBeenCalled();
      // The round's verifier writes the report and the verdicts.
      expect(client.verify.upsertReport.mutate).not.toHaveBeenCalled();
      expect(client.verify.submitCheckEvidence.mutate).toHaveBeenCalledWith({
        checkItemId: 'vci_reload',
        operationId: 'op-task',
        toulmin: { evidence: 'device chip renders on the first frame' },
      });
      expect(client.verify.uploadEvidence.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          checkResultId: 'result-vci_reload',
          metadata: { chapters },
          type: 'video',
        }),
      );
      expect(client.acceptanceComment.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ acceptanceId: 'acceptance-task', contextRunId: 'plan-run' }),
      );
      expect(result()).toMatchObject({
        acceptanceUrl: 'https://app.lobehub.com/acceptance/acceptance-task',
        missingEvidence: [],
        mode: 'plan-round',
        publicationStatus: 'complete',
        roundIndex: 1,
        verifyRunId: 'plan-run',
      });
      expect(process.exitCode).toBeUndefined();
    });

    it('rejects a case id outside the frozen plan before writing anything', async () => {
      await writeRound([{ evidence: ['scroll.mp4'], id: 'reload', status: 'passed' }]);

      await expect(run('ingest', h.dir, '--operation', 'op-task')).rejects.toThrow('exit 1');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('vci_reload'));
      expect(client.verify.submitCheckEvidence.mutate).not.toHaveBeenCalled();
      expect(uploadLocalFile).not.toHaveBeenCalled();
    });

    it('reports a planned video that never got a case as missing', async () => {
      await writeRound([{ evidence: ['output.txt'], id: 'vci_code', status: 'passed' }]);

      await run('ingest', h.dir, '--operation', 'op-task', '--json');

      expect(process.exitCode).toBe(1);
      expect(result()).toMatchObject({
        missingEvidence: [{ checkItemId: 'vci_reload', types: ['video'] }],
        publicationStatus: 'partial',
        unexecuted: ['vci_reload'],
      });
    });

    it('applies the verifier gate: deliverable scopes and same-medium substitutes are covered', async () => {
      client.verify.getVerifyState.query.mockResolvedValue({
        verifyPlan: [
          {
            ...frozenPlan[0],
            verifierConfig: {
              requiredEvidence: [{ type: 'gif' }, { scope: 'deliverable', type: 'markdown' }],
            },
          },
          {
            ...frozenPlan[1],
            verifierConfig: { requiredEvidence: [{ scope: 'task_artifacts', type: 'text' }] },
          },
        ],
        verifyPlanConfirmedAt: '2026-10-12T17:35:52.000Z',
        verifyRunId: 'plan-run',
      });
      // A recording uploaded as video satisfies a gif requirement; the deliverable
      // markdown and the unexecuted item's task artifact are the verifier's to resolve.
      await writeRound([{ evidence: ['scroll.mp4'], id: 'vci_reload', status: 'passed' }]);

      await run('ingest', h.dir, '--operation', 'op-task', '--json');

      expect(result()).toMatchObject({ missingEvidence: [], publicationStatus: 'complete' });
      expect(process.exitCode).toBeUndefined();
    });

    it('posts the proposal on the repair round the evidence was redirected to', async () => {
      // A check whose failure spawned a repair is answered on the live repair
      // round; the proposal and the output must name that round, not the old one.
      client.verify.submitCheckEvidence.mutate.mockImplementation(async (input) => ({
        checkResult: { id: `result-${input.checkItemId}`, verifyRunId: 'repair-run' },
        evidence: [],
      }));
      client.verify.getRun.query.mockImplementation(async ({ verifyRunId }) =>
        verifyRunId === 'repair-run'
          ? { acceptanceId: 'acceptance-task', id: 'repair-run', roundIndex: 2 }
          : { acceptanceId: 'acceptance-task', id: 'plan-run', roundIndex: 1 },
      );
      await writeRound([
        { evidence: ['scroll.mp4'], id: 'vci_reload', status: 'passed' },
        { evidence: ['output.txt'], id: 'vci_code', status: 'passed' },
      ]);

      await run('ingest', h.dir, '--operation', 'op-task', '--json');

      expect(client.acceptanceComment.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'proposal:repair-run', contextRunId: 'repair-run' }),
      );
      expect(result()).toMatchObject({ roundIndex: 2, verifyRunId: 'repair-run' });
    });

    it('reports an unattached plan round as blocked, not complete', async () => {
      client.verify.getRun.query.mockResolvedValue({
        acceptanceId: null,
        id: 'plan-run',
        roundIndex: null,
      });
      await writeRound([
        { evidence: ['scroll.mp4'], id: 'vci_reload', status: 'passed' },
        { evidence: ['output.txt'], id: 'vci_code', status: 'passed' },
      ]);

      await run('ingest', h.dir, '--operation', 'op-task', '--json');

      expect(result()).toMatchObject({
        acceptanceUrl: null,
        missingEvidence: [],
        publicationStatus: 'blocked',
      });
      expect(process.exitCode).toBe(1);
    });

    it('refuses to fold a retry into an earlier authored round under the same operation', async () => {
      // An authored ingest with --operation leaves a run whose plan was never
      // confirmed; it is not a plan round, and its verdicts and report are final.
      client.verify.getVerifyState.query.mockResolvedValue({
        verifyPlan: [{ id: 'screen', title: '用户能看到处理结果' }],
        verifyPlanConfirmedAt: null,
        verifyRunId: 'authored-run',
      });
      await report([], ['output.txt']);

      await expect(run('ingest', h.dir, '--operation', 'op-authored')).rejects.toThrow('exit 1');

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('authored-run'));
      expect(client.verify.submitCheckEvidence.mutate).not.toHaveBeenCalled();
      expect(client.verify.createRun.mutate).not.toHaveBeenCalled();
      expect(client.verify.uploadEvidence.mutate).not.toHaveBeenCalled();
    });

    it('keeps creating a round for an operation with no verification run', async () => {
      client.verify.getVerifyState.query.mockResolvedValue(null);
      await report([], ['output.txt']);

      await run('ingest', h.dir, '--operation', 'op-free', '--json');

      expect(client.verify.createRun.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'op-free' }),
      );
      expect(client.verify.submitCheckEvidence.mutate).not.toHaveBeenCalled();
    });
  });
});
