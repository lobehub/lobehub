import { describe, expect, it } from 'vitest';

import {
  buildMaintenanceActionIdempotencyKey,
  buildNightlyReviewSourceId,
  buildSelfIterationIntentSourceId,
  buildSelfReflectionSourceId,
  isActionExecutable,
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  ReviewRunStatus,
} from '../types';

describe('maintenance contracts', () => {
  /**
   * @example
   * buildNightlyReviewSourceId({ userId: 'u', agentId: 'a', localDate: '2026-05-04' })
   * returns 'nightly-review:u:a:2026-05-04'.
   */
  it('builds stable nightly review source ids', () => {
    expect(
      buildNightlyReviewSourceId({
        agentId: 'agent-1',
        localDate: '2026-05-04',
        userId: 'user-1',
      }),
    ).toBe('nightly-review:user-1:agent-1:2026-05-04');
  });

  /**
   * @example
   * buildSelfReflectionSourceId({ scopeType: 'task', scopeId: 'task-1' }) includes the scope.
   */
  it('builds stable self-reflection source ids', () => {
    expect(
      buildSelfReflectionSourceId({
        agentId: 'agent-1',
        reason: 'failed_tool_count',
        scopeId: 'task-1',
        scopeType: 'task',
        userId: 'user-1',
        windowEnd: '2026-05-04T14:30:00.000Z',
        windowStart: '2026-05-04T14:00:00.000Z',
      }),
    ).toBe(
      'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
    );
  });

  /**
   * @example
   * buildSelfIterationIntentSourceId({ toolCallId: 'call-1' }) includes the tool call id.
   */
  it('builds stable self-iteration intent source ids', () => {
    expect(
      buildSelfIterationIntentSourceId({
        agentId: 'agent-1',
        scopeId: 'topic-1',
        scopeType: 'topic',
        toolCallId: 'tool-call-1',
        userId: 'user-1',
      }),
    ).toBe('self-iteration-intent:user-1:agent-1:topic:topic-1:tool-call-1');
  });

  /**
   * @example
   * buildMaintenanceActionIdempotencyKey({ sourceId, actionType, dedupeKey })
   * returns a stable action-specific idempotency key.
   */
  it('builds action idempotency keys from source and action identity', () => {
    expect(
      buildMaintenanceActionIdempotencyKey({
        actionType: 'refine_skill',
        dedupeKey: 'skill:agent-doc-1',
        sourceId: 'source-1',
      }),
    ).toBe('source-1:refine_skill:skill:agent-doc-1');
  });

  /**
   * @example
   * isActionExecutable({ applyMode: 'auto_apply' }) returns true.
   */
  it('identifies executable action modes', () => {
    expect(isActionExecutable(MaintenanceApplyMode.AutoApply)).toBe(true);
    expect(isActionExecutable(MaintenanceApplyMode.ProposalOnly)).toBe(false);
    expect(isActionExecutable(MaintenanceApplyMode.Skip)).toBe(false);
  });

  /**
   * @example
   * Status constants remain stable for persisted receipts and observability.
   */
  it('keeps persisted status and scope string values stable', () => {
    expect(MaintenanceReviewScope.Nightly).toBe('nightly');
    expect(MaintenanceReviewScope.SelfReflection).toBe('self_reflection');
    expect(MaintenanceReviewScope.SelfIterationIntent).toBe('self_iteration_intent');
    expect(ReviewRunStatus.PartiallyApplied).toBe('partially_applied');
    expect(MaintenanceActionStatus.Proposed).toBe('proposed');
  });
});
