import { describe, expect, it } from 'vitest';

import {
  goalAcceptanceState,
  isFinalAcceptanceReady,
  latestRunStatus,
  pickFinalDeliverable,
} from './goalAcceptanceReport';

describe('goalAcceptanceState', () => {
  /**
   * Regression: the terminal acceptance only ever showed a small "待你确认" chip,
   * which read the same for a Goal awaiting sign-off and one that failed.
   */
  it('tells a passed delivery awaiting sign-off from one that needs a decision', () => {
    expect(goalAcceptanceState('delivered', 'passed')).toBe('awaitingAcceptance');
    expect(goalAcceptanceState('delivered', 'failed')).toBe('awaitingDecision');
    expect(goalAcceptanceState('delivered', undefined)).toBe('awaitingDecision');
  });

  it('maps the running and settled statuses', () => {
    expect(goalAcceptanceState('verifying')).toBe('inProgress');
    expect(goalAcceptanceState('repairing')).toBe('inProgress');
    expect(goalAcceptanceState('planned')).toBe('inProgress');
    expect(goalAcceptanceState('accepted')).toBe('accepted');
    expect(goalAcceptanceState('rejected')).toBe('rejected');
    expect(goalAcceptanceState('errored')).toBe('errored');
    expect(goalAcceptanceState('closed')).toBeUndefined();
  });
});

describe('isFinalAcceptanceReady', () => {
  /**
   * Regression: the report view showed on an acceptance that was still lost and
   * retrying, next to a ledger of failed attempts. It belongs only to a Goal
   * whose final acceptance finished and waits on sign-off.
   */
  it('shows the report only once the acceptance task finished and passed', () => {
    expect(isFinalAcceptanceReady('resolved', 'awaitingAcceptance')).toBe(true);
    expect(isFinalAcceptanceReady('resolved', 'accepted')).toBe(true);
    expect(isFinalAcceptanceReady('active', 'awaitingAcceptance')).toBe(false);
    expect(isFinalAcceptanceReady('waiting', 'awaitingDecision')).toBe(false);
    expect(isFinalAcceptanceReady('resolved', 'awaitingDecision')).toBe(false);
    expect(isFinalAcceptanceReady('resolved', 'inProgress')).toBe(false);
    expect(isFinalAcceptanceReady('resolved', undefined)).toBe(false);
  });
});

describe('pickFinalDeliverable', () => {
  const artifact = (
    resourceId: string,
    minute: number,
    nodeId = 'task_work',
    type = 'document',
  ) => ({
    createdAt: new Date(2026, 8, 16, 1, minute),
    nodeId,
    resourceId,
    title: `Doc ${resourceId}`,
    type,
  });

  /**
   * Regression: the finished Goal showed the acceptance report (and before that
   * the acceptance Task's synthesized finding) in place of the task list, while
   * the owner wanted to read the product the Goal made.
   */
  it('picks the newest document the work produced', () => {
    expect(
      pickFinalDeliverable(
        [
          artifact('docs_old', 1),
          artifact('docs_new', 5),
          artifact('file_1', 9, 'task_work', 'file'),
        ],
        'task_acceptance',
      ),
    ).toEqual({ documentId: 'docs_new', nodeId: 'task_work', title: 'Doc docs_new' });
  });

  it('prefers the work over a document the acceptance task wrote', () => {
    expect(
      pickFinalDeliverable(
        [artifact('docs_work', 1), artifact('docs_check_notes', 9, 'task_acceptance')],
        'task_acceptance',
      ),
    ).toMatchObject({ documentId: 'docs_work' });

    expect(
      pickFinalDeliverable([artifact('docs_check_notes', 9, 'task_acceptance')], 'task_acceptance'),
    ).toMatchObject({ documentId: 'docs_check_notes' });
  });

  it('keeps the binding id so the document opens in-app', () => {
    expect(
      pickFinalDeliverable(
        [{ ...artifact('docs_1', 1), agentDocumentId: 'agd_1' }],
        'task_acceptance',
      ),
    ).toMatchObject({ agentDocumentId: 'agd_1', documentId: 'docs_1' });
  });

  it('returns nothing when the Goal left no document', () => {
    expect(pickFinalDeliverable([], 'task_acceptance')).toBeUndefined();
    expect(
      pickFinalDeliverable([artifact('file_1', 1, 'task_work', 'file')], 'task_acceptance'),
    ).toBeUndefined();
  });
});

describe('latestRunStatus', () => {
  it('reads the newest round', () => {
    expect(
      latestRunStatus([
        { run: { status: 'failed' } },
        { run: { status: 'failed' } },
        { run: { status: 'repairing' } },
      ]),
    ).toBe('repairing');
    expect(latestRunStatus([])).toBeUndefined();
  });
});
