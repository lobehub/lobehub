// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';

vi.mock('@/database/models/work', () => import('./testUtils').then((m) => m.workModelModule()));
vi.mock('@/database/models/topic', () => import('./testUtils').then((m) => m.topicModelModule()));
vi.mock('@/business/server/agent-run/agentInterventionReview', () =>
  import('./testUtils').then((m) => m.agentInterventionReviewModule()),
);
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () =>
  import('./testUtils').then((m) => m.notifyAgentRunCompletedModule()),
);
vi.mock('../agentInterventionNotification', () =>
  import('./testUtils').then((m) => m.agentInterventionNotificationModule()),
);

// The state a run stopped before step 0 (or during its deferred init) carries:
// no assistant turn yet, only the placeholder the send created on `origin`.
const stoppedState = {
  host: { hooks: [] },
  messages: [{ content: 'write me a poem', id: 'msg-user', role: 'user' }],
  origin: { agentId: 'agent-1', assistantMessageId: 'msg-ast', topicId: 'tpc-1', userId: 'user-1' },
  status: 'interrupted',
};

const marker = { metadata: { interruptedMidStream: true } };

const run = async (latestRunRow: { id: string } | undefined, reason = 'interrupted') => {
  const lifecycle = new CompletionLifecycle({} as any, 'user-1');
  vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
  vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
  vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
  const update = vi.fn().mockResolvedValue({ success: true });
  // `call_llm` stamps `metadata.operationId` on every row a step creates or reuses.
  const findLatestAssistantByOperationId = vi.fn().mockResolvedValue(latestRunRow);
  (lifecycle as any).messageModel = {
    findById: vi.fn().mockResolvedValue(undefined),
    findLatestAssistantByOperationId,
    update,
  };

  await lifecycle.dispatchHooks('op-1', stoppedState, reason);

  return { update };
};

describe('CompletionLifecycle.dispatchHooks — interrupted turn marker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ROOT CAUSE:
  //
  // A stop that lands before the first token (before step 0 runs, during a
  // deferred init) settles the operation but never touches the assistant row.
  // It keeps the `...` placeholder with no marker, so every client renders an
  // empty bubble.
  //
  // Before: the row stayed a bare placeholder. After: it carries the persisted
  // stopped marker the clients render.
  it('marks the placeholder when the run stopped before any step stamped a row', async () => {
    const { update } = await run(undefined);

    expect(update).toHaveBeenCalledWith('msg-ast', marker);
  });

  // A Stop during a later step (a tool call, or a stream that did not end
  // through the finalizer) left the interrupted step's row unmarked, so after a
  // refresh the turn read as finished.
  it('marks the row of the interrupted step, not the placeholder of an earlier step', async () => {
    const { update } = await run({ id: 'msg-step-3' });

    expect(update).toHaveBeenCalledWith('msg-step-3', marker);
    expect(update).not.toHaveBeenCalledWith('msg-ast', marker);
  });

  it('does not mark a run that finished normally', async () => {
    const { update } = await run({ id: 'msg-step-3' }, 'done');

    expect(update).not.toHaveBeenCalledWith(expect.anything(), marker);
  });
});
