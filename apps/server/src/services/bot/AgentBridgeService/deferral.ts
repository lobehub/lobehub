import type { ChatTopicBotContext } from '@lobechat/types';
import type { Message, Thread } from 'chat';
import debug from 'debug';

import { TopicModel } from '@/database/models/topic';

import { deferBotMessages, isDeferredMessagesAvailable } from '../deferredMessages';
import { runDeferredReplay, scheduleDeferredReplay } from '../deferredReplay';
import { getSourceMessages } from '../mergeMessages';
import type { BridgeExecutionDeps, ThreadState } from './types';

const log = debug('lobe-server:bot:agent-bridge');

/**
 * Park an inbound follow-up whose topic is still running so the completion
 * callback can replay it. Returns `false` when deferral is impossible (no
 * bot context, no Redis) — the caller then keeps the previous behavior.
 */
export async function deferWhileTopicBusy(
  deps: Pick<BridgeExecutionDeps, 'db' | 'userId' | 'workspaceId'>,
  thread: Thread<ThreadState>,
  message: Message,
  botContext: ChatTopicBotContext | undefined,
  topicId: string,
): Promise<boolean> {
  if (!botContext?.applicationId) return false;
  if (!isDeferredMessagesAvailable()) return false;

  // Store the individual sources of a merged message so each keeps its own
  // `raw` (media descriptors) across the Redis round-trip.
  const deferred = await deferBotMessages(
    botContext.applicationId,
    thread.id,
    getSourceMessages(message),
  );
  if (!deferred) return false;

  // Completion may have drained the queue between the initial liveness
  // check and this write. Recheck after enqueueing and initiate replay when
  // no live operation remains; the callback covers completion after this check.
  const target = {
    applicationId: botContext.applicationId,
    messengerInstallationKey: botContext.messengerInstallationKey,
    platform: botContext.platform,
    platformThreadId: thread.id,
  };
  try {
    const topicModel = new TopicModel(deps.db, deps.userId, deps.workspaceId);
    const topic = await topicModel.findById(topicId);
    const running = topic?.metadata?.runningOperation;
    if (!running || !(await topicModel.isRunningOperationAlive(deps.db, running))) {
      await runDeferredReplay(target);
    }
  } catch (error) {
    log('Post-enqueue replay failed for thread=%s: %O', thread.id, error);
    try {
      await scheduleDeferredReplay(target, `defer:${message.id}`);
    } catch (scheduleError) {
      log('Could not schedule deferred replay for thread=%s: %O', thread.id, scheduleError);
    }
  }

  log(
    'handleSubscribedMessage: topic busy, deferred message=%s on thread=%s until the running operation completes',
    message.id,
    thread.id,
  );
  return true;
}
