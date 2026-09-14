import { describe, expect, it, vi } from 'vitest';

import { createQuickNoteAnalyzeSourceHandler } from './quickNoteAnalyze';

/** @example Quick Note Analyze source handling is thin, validated, and idempotent upstream. */
describe('createQuickNoteAnalyzeSourceHandler', () => {
  /** @example A valid claimed Run is handed to the durable Agent dispatcher once. */
  it('dispatches the claimed domain Run', async () => {
    const dispatch = vi.fn().mockResolvedValue({ operationId: 'op-1' });
    const handler = createQuickNoteAnalyzeSourceHandler({ dispatch });

    const result = await handler.handle({
      chain: { chainId: 'chain:qn_1', rootSourceId: '11111111-1111-1111-1111-111111111111' },
      payload: {
        quickNoteId: 'qn_1',
        runId: '11111111-1111-1111-1111-111111111111',
        sourceHistoryId: 'history-1',
        trigger: 'manual',
        userId: 'user-1',
      },
      scopeKey: 'quick-note:qn_1',
      sourceId: '11111111-1111-1111-1111-111111111111',
      sourceType: 'quick_note.analyze.requested',
      timestamp: 1,
    });

    /** @example The handler dispatches by immutable Run identity, not mutable note content. */
    expect(dispatch).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    /** @example Trace output links the Signal source revision to the dispatched operation. */
    expect(result).toMatchObject({
      concluded: {
        operationId: 'op-1',
        quickNoteId: 'qn_1',
        runId: '11111111-1111-1111-1111-111111111111',
        sourceHistoryId: 'history-1',
        trigger: 'manual',
        status: 'dispatched',
      },
      status: 'conclude',
    });
  });

  /** @example An unavailable Run remains traceable without inventing an Agent operation. */
  it('keeps source revision linkage when dispatch is unavailable', async () => {
    const handler = createQuickNoteAnalyzeSourceHandler({
      dispatch: vi.fn().mockResolvedValue(undefined),
    });

    const result = await handler.handle({
      chain: { chainId: 'chain:qn_1', rootSourceId: '11111111-1111-1111-1111-111111111111' },
      payload: {
        quickNoteId: 'qn_1',
        runId: '11111111-1111-1111-1111-111111111111',
        sourceHistoryId: 'history-1',
        trigger: 'automatic',
        userId: 'user-1',
      },
      scopeKey: 'quick-note:qn_1',
      sourceId: '11111111-1111-1111-1111-111111111111',
      sourceType: 'quick_note.analyze.requested',
      timestamp: 1,
    });

    /** @example The terminal trace explains the no-op and retains immutable source references. */
    expect(result).toEqual({
      concluded: {
        quickNoteId: 'qn_1',
        reason: 'run_unavailable',
        runId: '11111111-1111-1111-1111-111111111111',
        sourceHistoryId: 'history-1',
        trigger: 'automatic',
      },
      status: 'conclude',
    });
  });
});
