import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';

import { sweepQuickNoteAnalyze } from './sweep';

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(),
  claim: vi.fn(),
  enqueue: vi.fn(),
  flags: vi.fn(),
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/quickNote', () => ({
  QuickNoteModel: class {
    static findDueAnalyzeCandidates = mocks.candidates;
    claimRun = mocks.claim;
  },
}));
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mocks.flags,
}));
vi.mock('@/server/services/agentSignal', () => ({ enqueueAgentSignalSourceEvent: mocks.enqueue }));

beforeEach(() => vi.resetAllMocks());

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
    expect(await response.json()).toEqual({ checked: 2, enqueued: 1, success: true });
    /** @example The disabled candidate never acquires a run. */
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith('allowed-note', {
      kind: 'analyze',
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
    expect(await response.json()).toEqual({ checked: 101, enqueued: 1, success: true });
    /** @example The next query resumes after the disabled page rather than rereading it. */
    expect(mocks.candidates.mock.calls[1][1]).toMatchObject({
      after: { id: 'disabled-99', analyzeDueAt: new Date(0) },
    });
  });
});
