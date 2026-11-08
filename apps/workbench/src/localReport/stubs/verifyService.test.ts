/**
 * @vitest-environment happy-dom
 *
 * The offline report decides the whole delivery the way the hosted page does:
 * the decision lands in the local review log, and the acceptance settles.
 */
import type { LocalAcceptanceSource } from '@lobechat/utils/verify/localAcceptance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = (settled: boolean): LocalAcceptanceSource => ({
  acceptance: {
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'acc-1',
    requirement: 'Rename keeps the title',
    subjectKey: 'standalone-rename',
  },
  format: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  reviews: [],
  rounds: [
    {
      dir: '20260101-000000-first',
      evidence: [],
      proposal: null,
      report: settled
        ? {
            content: null,
            failedChecks: 0,
            overallConfidence: null,
            passedChecks: 1,
            summary: null,
            totalChecks: 1,
            uncertainChecks: null,
            verdict: 'passed',
          }
        : null,
      results: [
        {
          checkItemId: 'rename',
          checkItemIndex: 0,
          checkItemTitle: 'Rename keeps the title',
          createdAt: '2026-01-01T00:00:00.000Z',
          id: 'result-1',
          metadata: null,
          required: true,
          suggestion: null,
          toulmin: null,
          verdict: 'passed',
        },
      ],
      run: {
        context: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        goal: null,
        id: 'run-1',
        metadata: null,
        plan: null,
        roundIndex: 1,
        scenario: 'coding',
        title: 'Rename',
      },
    },
  ],
});

/** A fresh page load: new document data, new module instances, same localStorage. */
const openPage = async (data: LocalAcceptanceSource) => {
  document.body.innerHTML = `<script id="acceptance-local-data" type="application/json">${JSON.stringify(data)}</script>`;
  vi.resetModules();
  const { getLocalReport } = await import('../localReportData');
  const { verifyService } = await import('./verifyService');
  return { report: getLocalReport(), verifyService };
};

describe('local verifyService delivery decisions', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts the delivery into the review log, and keeps it across reloads', async () => {
    const { report, verifyService } = await openPage(source(true));
    await verifyService.reviewChecks({ action: 'accept', checkItemIds: ['rename'] });
    expect(report.bundle().acceptance.status).toBe('delivered');

    const accepted = await verifyService.acceptDelivery('acc-1');
    expect(accepted.status).toBe('accepted');
    expect(report.exportLog().events.at(-1)).toMatchObject({
      action: 'accept',
      kind: 'decision',
      roundIndex: 1,
    });

    const reloaded = await openPage(source(true));
    expect(reloaded.report.bundle().acceptance.status).toBe('accepted');
    await expect(reloaded.verifyService.rejectDelivery('acc-1', 'late')).rejects.toThrow(
      'already been accepted',
    );
  });

  it('rejects with the reason the next round reads', async () => {
    const { report, verifyService } = await openPage(source(true));
    await verifyService.rejectDelivery('acc-1', 'Focus is lost');
    const round = report.bundle().rounds[0]!.run;
    expect(report.bundle().acceptance.status).toBe('rejected');
    expect(round.userDecision).toBe('reject');
    expect(round.decisionDetail?.comment).toBe('Focus is lost');
  });

  it('refuses a decision before the round settles, like the server', async () => {
    const { verifyService } = await openPage(source(false));
    await expect(verifyService.acceptDelivery('acc-1')).rejects.toThrow('still in progress');
  });
});
