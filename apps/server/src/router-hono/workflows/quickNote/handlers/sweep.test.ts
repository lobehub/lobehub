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
});
