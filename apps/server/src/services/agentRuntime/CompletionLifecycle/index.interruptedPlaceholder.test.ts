// @vitest-environment node
import { LOADING_FLAT } from '@lobechat/const';
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

const run = async (row: Record<string, unknown> | undefined, reason = 'interrupted') => {
  const lifecycle = new CompletionLifecycle({} as any, 'user-1');
  vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
  vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
  vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
  const update = vi.fn().mockResolvedValue({ success: true });
  const findById = vi.fn().mockResolvedValue(row);
  (lifecycle as any).messageModel = { findById, update };

  await lifecycle.dispatchHooks('op-1', stoppedState, reason);

  return { findById, update };
};

describe('CompletionLifecycle.dispatchHooks — run stopped before its first output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ROOT CAUSE:
  //
  // A stop that lands before the first token (before step 0 runs, during a
  // deferred init, or while the LLM call has produced nothing) settles the
  // operation but never touches the assistant row. It keeps the `...`
  // placeholder with no marker, so every client renders an empty bubble.
  //
  // Before: the row stayed a bare placeholder. After: it carries the persisted
  // stopped marker the clients render.
  it('marks the placeholder row stopped', async () => {
    const { findById, update } = await run({ content: LOADING_FLAT, id: 'msg-ast' });

    expect(findById).toHaveBeenCalledWith('msg-ast');
    expect(update).toHaveBeenCalledWith('msg-ast', { metadata: { interruptedMidStream: true } });
  });

  it('leaves a row that already holds output alone', async () => {
    const withText = await run({ content: 'Roses are', id: 'msg-ast' });
    const withTools = await run({ content: LOADING_FLAT, id: 'msg-ast', tools: [{ id: 't1' }] });

    expect(withText.update).not.toHaveBeenCalled();
    expect(withTools.update).not.toHaveBeenCalled();
  });

  it('does not mark the placeholder for a run that did not stop', async () => {
    const { update } = await run({ content: LOADING_FLAT, id: 'msg-ast' }, 'done');

    expect(update).not.toHaveBeenCalledWith('msg-ast', {
      metadata: { interruptedMidStream: true },
    });
  });
});
