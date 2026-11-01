import debug from 'debug';

import type { ThreadModel } from '@/database/models/thread';

import type { InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface NewThreadDeps {
  threadModel: ThreadModel;
}

/**
 * Materialise an `appContext.newThread` intent into a real thread row.
 *
 * The composer stages a subtopic client-side and the non-gateway send path
 * creates it inside `sendMessageInServer` (`newThread`). The gateway path
 * never makes that call, so the intent arrives here instead — without this
 * the turn would persist onto the topic's main spine, no thread row would
 * exist, and the subtopic would silently collapse back into the main
 * conversation.
 *
 * Returns the params to run with: `appContext.threadId` rebound to the new
 * thread so every downstream read (message writes, history queries, operation
 * context) lands inside it. A no-op for every caller that doesn't ask for one.
 */
export const resolveNewThread = async (
  deps: NewThreadDeps,
  params: InternalExecAgentParams,
): Promise<{
  createdThreadId?: string;
  params: InternalExecAgentParams;
}> => {
  const { appContext } = params;
  const newThread = appContext?.newThread;

  // `threadId` wins: that is a follow-up inside a thread that already exists,
  // and creating a second row would orphan the earlier turns.
  if (!newThread || appContext?.threadId) return { params };

  // A subtopic branches off a persisted message, so its topic always exists by
  // the time the send reaches here. Refusing is better than silently creating
  // a thread on a topic this run is about to mint under a different id.
  if (!appContext?.topicId) {
    throw new Error('appContext.newThread requires an existing appContext.topicId');
  }

  const thread = await deps.threadModel.create({
    parentThreadId: newThread.parentThreadId,
    sourceMessageId: newThread.sourceMessageId,
    title: newThread.title,
    topicId: appContext.topicId,
    type: newThread.type,
  });

  // `ThreadModel.create` swallows insert conflicts and returns undefined.
  // Falling through would persist the turn to the main spine — exactly the
  // failure this path exists to prevent — so fail loudly instead.
  if (!thread) {
    throw new Error(`Failed to create thread on topic ${appContext.topicId}`);
  }

  log('execAgent: created thread %s on topic %s', thread.id, appContext.topicId);

  return {
    createdThreadId: thread.id,
    params: {
      ...params,
      appContext: { ...appContext, threadId: thread.id },
      createdThreadId: thread.id,
    },
  };
};
