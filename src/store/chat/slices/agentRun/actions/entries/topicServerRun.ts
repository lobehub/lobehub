import type { ConversationContext } from '@lobechat/types';

import { aiAgentService } from '@/services/aiAgent';
import { topicService } from '@/services/topic';
import type { ChatStoreState } from '@/store/chat/initialState';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import type { ChatStore } from '@/store/chat/store';
import { notifyRunEndedWithoutRunner, notifyRunStopFailed } from '@/store/chat/utils/runStop';
import type { StoreSetter } from '@/store/types';

/**
 * The operation id of a topic's server-side run that no local operation
 * follows, so the composer would otherwise offer no Stop.
 *
 * The server keeps a run's `runningOperation` marker until the run settles,
 * while this tab can lose its local operation without the run ending: the
 * desktop runner was closed, the gateway stream ended without a terminal
 * frame, or the page reloaded and the reconnect gave up. The topic still reads
 * `running` everywhere, and a Stop keyed on the local operation never shows.
 *
 * Main line only (thread runs never own the topic marker). A local run of the
 * input's own types, aborting or not, still owns the Stop button.
 */
export const untrackedServerRunIdSelector =
  (context: Pick<ConversationContext, 'agentId' | 'groupId' | 'scope' | 'threadId' | 'topicId'>) =>
  (s: ChatStoreState): string | undefined => {
    if (!context.topicId || context.threadId) return;

    const marker = topicSelectors.getTopicById(context.topicId)(s)?.metadata?.runningOperation;
    if (!marker?.operationId) return;

    const followed = operationSelectors
      .getOperationsByContext(context)(s)
      .some((op) => op.status === 'running' && INPUT_LOADING_OPERATION_TYPES.includes(op.type));

    return followed ? undefined : marker.operationId;
  };

type Setter = StoreSetter<ChatStore>;

export class TopicServerRunActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  /**
   * End the server-side run of a topic that no local operation follows.
   *
   * Use when:
   * - The topic still carries a `runningOperation` marker but this tab has no
   *   run of its own to cancel (see {@link untrackedServerRunIdSelector}).
   *   Without this the topic shows `running` with no Stop.
   *
   * Goes through the topic-level stop (`aiAgent.interruptTask({ topicId })`),
   * the same one `lh topic stop` uses: it stops the caller's live runs on the
   * topic, settles one whose device runner is gone, and releases a marker
   * whose run already ended. On failure it says why and, unless this already
   * was a forced stop, offers to force it.
   *
   * Returns whether the run was ended.
   */
  stopTopicServerRun = async (
    context: ConversationContext,
    options: { force?: boolean } = {},
  ): Promise<boolean> => {
    const { topicId } = context;
    if (!topicId || context.threadId) return true;

    let result: Awaited<ReturnType<typeof aiAgentService.interruptTask>>;
    try {
      result = await aiAgentService.interruptTask({
        ...(options.force ? { force: true } : {}),
        topicId,
      });
    } catch (error) {
      console.error('[topicServerRun] stopping the topic run failed:', error);
      notifyRunStopFailed(undefined);
      return false;
    }

    if (!result.success) {
      notifyRunStopFailed(
        result.failureReason,
        options.force ? undefined : () => void this.stopTopicServerRun(context, { force: true }),
      );
      return false;
    }

    const remaining = await this.#syncTopicRunFromServer(topicId);
    // Nothing of the caller's was live and the marker survived: the run belongs
    // to someone else (a teammate's run on a shared topic), so this stop could
    // not end it. Say so instead of leaving the click without an answer.
    if (remaining && result.running === 0) {
      notifyRunStopFailed(undefined);
      return false;
    }
    if (result.completionReason) notifyRunEndedWithoutRunner();
    return true;
  };

  /**
   * Mirror the server's run marker and status into the local topic after a
   * topic-level stop. The server decides what ended (the caller's runs, a dead
   * marker) and what did not (a teammate's live run), so the local copy
   * follows it instead of being cleared blindly.
   *
   * Returns the run the server still holds on the topic, if any.
   */
  #syncTopicRunFromServer = async (topicId: string): Promise<string | undefined> => {
    const topic = await topicService.getTopicDetail(topicId).catch(() => undefined);
    const current = topicSelectors.getTopicById(topicId)(this.#get());
    if (!topic || !current) return;

    const remaining = topic.metadata?.runningOperation?.operationId;
    this.#get().internal_dispatchTopic({
      id: topicId,
      type: 'updateTopic',
      value: {
        metadata: {
          ...current.metadata,
          runningOperation: topic.metadata?.runningOperation ?? null,
        },
        status: topic.status ?? current.status,
      },
    });
    return remaining;
  };
}

export type TopicServerRunAction = Pick<TopicServerRunActionImpl, keyof TopicServerRunActionImpl>;
