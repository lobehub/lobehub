// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionLifecycle, type TopicRunSettledHandler } from '../CompletionLifecycle';
import { hookDispatcher } from '../hooks';

const { after } = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after }));
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () => ({
  notifyAgentRunCompleted: vi.fn(async () => {}),
}));
vi.mock('@/server/services/workRegistration', () => ({ registerWorksForOperation: vi.fn() }));
vi.mock('@/server/services/verify', () => ({
  runVerifyOnCompletion: vi.fn(async () => {}),
  settleFailedRepair: vi.fn(async () => {}),
}));

/**
 * A topic's own run settling is when work waiting on that topic — background
 * sub-agent results — may be handed over. Child runs, approval parks and user
 * stops must not trigger it.
 */
describe('CompletionLifecycle — topic run settled', () => {
  let onTopicRunSettled: ReturnType<typeof vi.fn<TopicRunSettledHandler>>;

  const run = async (origin: Record<string, unknown>, reason: string) => {
    const lifecycle = new CompletionLifecycle({} as any, 'user-1', undefined, {
      onTopicRunSettled,
    });
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'notifyPendingAgentIntervention').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'registerFileWorks').mockResolvedValue(undefined);
    await lifecycle.dispatchHooks('op-1', { host: { hooks: [] }, origin, status: reason }, reason);
  };

  /** Run every post-response task the lifecycle handed over. */
  const flushAfter = async () => {
    for (const [task] of after.mock.calls) await task();
  };

  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    after.mockReset();
    onTopicRunSettled = vi.fn<TopicRunSettledHandler>().mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
  });

  it.each(['done', 'error', 'max_steps'])(
    'reports the topic as settled after a %s run, as post-response work',
    async (reason) => {
      await run({ agentId: 'a', topicId: 'topic-1' }, reason);

      expect(onTopicRunSettled).not.toHaveBeenCalled();
      await flushAfter();
      expect(onTopicRunSettled).toHaveBeenCalledWith({ operationId: 'op-1', topicId: 'topic-1' });
    },
  );

  it.each(['interrupted', 'waiting_for_human', 'waiting_for_async_tool'])(
    'stays quiet when the run was %s',
    async (reason) => {
      await run({ agentId: 'a', topicId: 'topic-1' }, reason);
      await flushAfter();

      expect(onTopicRunSettled).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a sub-agent', { lineage: { isSubAgent: true, parentOperationId: 'p' } }],
    ['a group member', { lineage: { orchestrationRole: 'member' } }],
    ['a callAgent child', { lineage: { parentOperationId: 'p' } }],
    ['an Agent Signal run', { signal: { kind: 'self-iteration' } }],
  ])('stays quiet for %s', async (_label, extra) => {
    await run({ agentId: 'a', topicId: 'topic-1', ...extra }, 'done');
    await flushAfter();

    expect(onTopicRunSettled).not.toHaveBeenCalled();
  });

  it('stays quiet for a run without a topic', async () => {
    await run({ agentId: 'a' }, 'done');
    await flushAfter();

    expect(onTopicRunSettled).not.toHaveBeenCalled();
  });
});
