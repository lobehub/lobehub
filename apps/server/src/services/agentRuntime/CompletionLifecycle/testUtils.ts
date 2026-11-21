/**
 * Shared fakes for the CompletionLifecycle scenario tests. Each test file keeps
 * its own `vi.mock` calls (Vitest hoists them per file) and points the
 * factories here, so every file observes the same mock functions.
 */
import { vi } from 'vitest';

import type { NotifyAgentInterventionRequiredParams } from '@/business/server/agent-run/agentInterventionReview';

// Default async no-op implementation: the production code chains `.catch` on
// the returned promise, so a bare vi.fn() (returning undefined) would throw
// inside every unrelated `done`-path test. mockRestore/mockReset fall back to
// this original implementation.
export const mockBuildRuntimeInterventionNotification = vi.fn<
  () => Promise<NotifyAgentInterventionRequiredParams | undefined>
>(async () => undefined);
export const mockNotifyAgentInterventionRequired = vi.fn(async () => {});
export const mockNotifyAgentRunCompleted = vi.fn(async () => {});
export const mockListWorks = vi.fn(async (): Promise<{ id: string }[]> => []);
export const mockSettleRunningOperation = vi.fn(async () => ({ status: 'settled' as const }));

export const workModelModule = () => ({
  WorkModel: vi.fn(function () {
    return { listByRootOperation: mockListWorks };
  }),
});

// `TopicModel.settleRunningOperation` is a class FIELD (bound per instance, not
// on the prototype), so observing it means swapping the class. This is the only
// TopicModel use in the lifecycle, and the tests assert both that it runs for a
// finished run and that it is deliberately skipped otherwise.
export const topicModelModule = () => ({
  TopicModel: vi.fn(function () {
    return { settleRunningOperation: mockSettleRunningOperation };
  }),
});

export const agentInterventionReviewModule = () => ({
  notifyAgentInterventionRequired: mockNotifyAgentInterventionRequired,
});

export const notifyAgentRunCompletedModule = () => ({
  notifyAgentRunCompleted: mockNotifyAgentRunCompleted,
});

export const agentInterventionNotificationModule = () => ({
  buildRuntimeInterventionNotification: mockBuildRuntimeInterventionNotification,
});

export const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
