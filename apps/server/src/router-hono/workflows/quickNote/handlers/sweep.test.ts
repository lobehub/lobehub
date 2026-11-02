import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';

import { QUICK_NOTE_SWEEP_MAX_PAGES, sweepQuickNoteAnalyze } from './sweep';

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(),
  claim: vi.fn(),
  claimContentCheck: vi.fn(),
  contentCheckCandidates: vi.fn(),
  enqueue: vi.fn(),
  flags: vi.fn(),
  queryProposals: vi.fn(),
  releaseContentCheck: vi.fn(),
  retireDueWork: vi.fn(),
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/quickNote', () => ({
  QuickNoteModel: class {
    static claimContentCheck = mocks.claimContentCheck;
    static findDueAnalyzeCandidates = mocks.candidates;
    static findDueContentCheckCandidates = mocks.contentCheckCandidates;
    static releaseContentCheck = mocks.releaseContentCheck;
    static retireDueWork = mocks.retireDueWork;
    queryProposals = mocks.queryProposals;
  },
}));
vi.mock('@/database/repositories/quickNote', () => ({
  QuickNoteRepository: class {
    claimRun = mocks.claim;
  },
}));
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mocks.flags,
}));
vi.mock('@/server/services/agentSignal', () => ({ enqueueAgentSignalSourceEvent: mocks.enqueue }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.contentCheckCandidates.mockResolvedValue([]);
});

/** @example Offline automatic analysis observes the same user rollout as interactive requests. */
describe('Quick Note sweep rollout', () => {
  /** @example Only an allowlisted candidate can claim an automatic run. */
  it('skips users outside the rollout before claiming work', async () => {
    mocks.candidates.mockResolvedValue([
      { id: 'denied-note', userId: 'other' },
      { id: 'allowed-note', userId: 'tester' },
    ]);
    mocks.flags.mockImplementation(async (userId: string) =>
      mapFeatureFlagsEnvToState({ quick_note: ['tester'] }, userId),
    );
    mocks.claim.mockResolvedValue({
      id: 'run-1',
      quickNoteId: 'allowed-note',
      sourceHistoryId: 'revision-1',
    });
    mocks.enqueue.mockResolvedValue({ accepted: true });
    const app = new Hono().post('/sweep', sweepQuickNoteAnalyze);
    const response = await app.request('/sweep', { method: 'POST' });
    /** @example The enabled candidate is processed successfully. */
    expect(await response.json()).toEqual({
      checked: 2,
      contentChecks: 0,
      enqueued: 1,
      success: true,
    });
    /** @example The disabled candidate never acquires a run. */
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith('allowed-note', {
      kind: 'analyze',
      renderSourceText: expect.any(Function),
      trigger: 'automatic',
    });
  });
  /** @example A full disabled prefix cannot hide an eligible note on the next page. */
  it('continues past 100 rollout-disabled candidates', async () => {
    // ROOT CAUSE:
    // Eligibility was checked after LIMIT 100, selecting the same disabled prefix forever.
    const disabled = Array.from({ length: 100 }, (_, index) => ({
      id: `disabled-${index}`,
      userId: 'disabled',
      analyzeDueAt: new Date(0),
    }));
    mocks.candidates
      .mockResolvedValueOnce(disabled)
      .mockResolvedValueOnce([{ id: 'eligible', userId: 'tester', analyzeDueAt: new Date(1) }]);
    mocks.flags.mockImplementation(async (userId: string) =>
      mapFeatureFlagsEnvToState({ quick_note: ['tester'] }, userId),
    );
    mocks.claim.mockResolvedValue({
      id: 'run',
      quickNoteId: 'eligible',
      sourceHistoryId: 'history',
    });
    mocks.enqueue.mockResolvedValue({ accepted: true });
    const response = await new Hono()
      .post('/sweep', sweepQuickNoteAnalyze)
      .request('/sweep', { method: 'POST' });
    /** @example The second page's eligible user receives automatic analysis. */
    expect(await response.json()).toEqual({
      checked: 101,
      contentChecks: 0,
      enqueued: 1,
      success: true,
    });
    /** @example The next query resumes after the disabled page rather than rereading it. */
    expect(mocks.candidates.mock.calls[1][1]).toMatchObject({
      after: { id: 'disabled-99', analyzeDueAt: new Date(0) },
    });
  });
});

/** @example Due work of rollout-disabled users is dropped instead of rescanned every minute. */
describe('Quick Note sweep disabled users', () => {
  // ROOT CAUSE:
  // Skipped candidates kept their overdue timestamps, so every sweep rescanned a disabled prefix
  // from the start and a large one could exhaust the request before reaching enabled notes.
  it("retires a disabled user's due work once per sweep", async () => {
    mocks.candidates.mockResolvedValue([
      { analyzeDueAt: new Date(0), id: 'denied-1', userId: 'other' },
      { analyzeDueAt: new Date(0), id: 'denied-2', userId: 'other' },
      { analyzeDueAt: new Date(0), id: 'allowed', userId: 'tester' },
    ]);
    mocks.contentCheckCandidates.mockResolvedValue([
      { contentCheckDueAt: new Date(0), id: 'denied-3', userId: 'other', workspaceId: null },
    ]);
    mocks.flags.mockImplementation(async (userId: string) =>
      mapFeatureFlagsEnvToState({ quick_note: ['tester'] }, userId),
    );
    mocks.claim.mockResolvedValue({ id: 'run', quickNoteId: 'allowed', sourceHistoryId: 'h' });
    mocks.enqueue.mockResolvedValue({ accepted: true });

    await new Hono().post('/sweep', sweepQuickNoteAnalyze).request('/sweep', { method: 'POST' });

    /** @example One retirement covers all of the disabled user's due notes. */
    expect(mocks.retireDueWork).toHaveBeenCalledOnce();
    expect(mocks.retireDueWork.mock.calls[0].slice(1)).toEqual(['other', expect.any(Date)]);
    /** @example The disabled user's content check is not claimed either. */
    expect(mocks.claimContentCheck).not.toHaveBeenCalled();
  });
});

/** @example Edits are checked once they go quiet, not on every keystroke. */
describe('Quick Note sweep content checks', () => {
  const pending = [{ decisionStatus: 'pending', validity: 'current' }];

  const sweep = async () =>
    (
      await new Hono().post('/sweep', sweepQuickNoteAnalyze).request('/sweep', { method: 'POST' })
    ).json();

  beforeEach(() => {
    mocks.candidates.mockResolvedValue([]);
    mocks.flags.mockResolvedValue({ enableQuickNote: true });
    mocks.enqueue.mockResolvedValue({ accepted: true });
  });

  it('emits one check per due note, keyed by its due time, without a fixed baseline', async () => {
    const dueAt = new Date('2026-10-20T01:00:00Z');
    mocks.contentCheckCandidates.mockResolvedValue([
      { contentCheckDueAt: dueAt, id: 'note-1', userId: 'tester', workspaceId: null },
    ]);
    mocks.claimContentCheck.mockResolvedValue(true);
    mocks.queryProposals.mockResolvedValue(pending);

    expect(await sweep()).toMatchObject({ contentChecks: 1 });
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(
      {
        payload: { quickNoteId: 'note-1', userId: 'tester' },
        scopeKey: 'quick-note:note-1',
        sourceId: `note-1:content-check:${dueAt.getTime()}`,
        sourceType: 'quick_note.content.changed',
      },
      { userId: 'tester', workspaceId: undefined },
    );
  });

  /** @example A later edit pushed the due time back, so that later time runs the check. */
  it('skips a note whose check was re-armed after the scan', async () => {
    mocks.contentCheckCandidates.mockResolvedValue([
      { contentCheckDueAt: new Date(0), id: 'note-1', userId: 'tester', workspaceId: null },
    ]);
    mocks.claimContentCheck.mockResolvedValue(false);

    expect(await sweep()).toMatchObject({ contentChecks: 0 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('clears the check without a model call when no Proposal can go stale', async () => {
    mocks.contentCheckCandidates.mockResolvedValue([
      { contentCheckDueAt: new Date(0), id: 'note-1', userId: 'tester', workspaceId: null },
    ]);
    mocks.claimContentCheck.mockResolvedValue(true);
    mocks.queryProposals.mockResolvedValue([{ decisionStatus: 'pending', validity: 'stale' }]);

    expect(await sweep()).toMatchObject({ contentChecks: 0 });
    expect(mocks.claimContentCheck).toHaveBeenCalledOnce();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  /** @example A failed enqueue leaves the check due, so the retried sweep runs it. */
  it('re-arms the claimed check when enqueueing fails', async () => {
    // ROOT CAUSE:
    // The claim cleared `content_check_due_at` before enqueueing; a throw returned 500 but left it
    // null, so the QStash retry found nothing due and the edit was never meaning-checked.
    const dueAt = new Date('2026-10-20T01:00:00Z');
    mocks.contentCheckCandidates.mockResolvedValue([
      { contentCheckDueAt: dueAt, id: 'note-1', userId: 'tester', workspaceId: null },
    ]);
    mocks.claimContentCheck.mockResolvedValue(true);
    mocks.queryProposals.mockResolvedValue(pending);
    mocks.enqueue.mockRejectedValue(new Error('queue unavailable'));

    const response = await new Hono()
      .post('/sweep', sweepQuickNoteAnalyze)
      .request('/sweep', { method: 'POST' });

    /** @example The sweep still fails so QStash retries it. */
    expect(response.status).toBe(500);
    /** @example The claimed due time is restored for that retry. */
    expect(mocks.releaseContentCheck).toHaveBeenCalledOnce();
    expect(mocks.releaseContentCheck.mock.calls[0].slice(1)).toEqual(['note-1', dueAt]);
  });
});

/** @example One invocation reads a bounded number of pages; the next tick continues. */
describe('Quick Note sweep page cap', () => {
  // ROOT CAUSE:
  // Both loops only stopped after enqueuing a full page, so a long run of skipped candidates
  // (already claimed, or no pending Proposal) kept one invocation paging through the whole backlog.
  it('stops each loop after the page cap even when nothing is enqueued', async () => {
    let page = 0;
    const fullPage = (key: 'analyzeDueAt' | 'contentCheckDueAt') => async () =>
      Array.from({ length: 100 }, (_, index) => ({
        [key]: new Date(page),
        id: `note-${page++}-${index}`,
        userId: 'tester',
        workspaceId: null,
      }));
    mocks.candidates.mockImplementation(fullPage('analyzeDueAt'));
    mocks.contentCheckCandidates.mockImplementation(fullPage('contentCheckDueAt'));
    mocks.flags.mockImplementation(async (userId: string) =>
      mapFeatureFlagsEnvToState({ quick_note: ['tester'] }, userId),
    );
    // Every candidate was claimed elsewhere, so nothing is ever enqueued.
    mocks.claim.mockResolvedValue(undefined);
    mocks.claimContentCheck.mockResolvedValue(false);

    const response = await new Hono()
      .post('/sweep', sweepQuickNoteAnalyze)
      .request('/sweep', { method: 'POST' });

    expect(await response.json()).toMatchObject({ contentChecks: 0, enqueued: 0, success: true });
    expect(mocks.candidates).toHaveBeenCalledTimes(QUICK_NOTE_SWEEP_MAX_PAGES);
    expect(mocks.contentCheckCandidates).toHaveBeenCalledTimes(QUICK_NOTE_SWEEP_MAX_PAGES);
  });
});
