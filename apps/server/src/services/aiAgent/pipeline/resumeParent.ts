import type { MessageModel } from '@/database/models/message';

import type { InternalExecAgentParams } from '../types';

export interface ResumeParentDeps {
  messageModel: MessageModel;
}

export type ResumeParentMessage = NonNullable<Awaited<ReturnType<MessageModel['findById']>>>;

/**
 * Load the message a resumed turn continues from, and check it belongs to the
 * conversation the caller claims (topic, thread and session).
 */
export const loadResumeParentMessage = async (
  deps: ResumeParentDeps,
  { appContext, parentMessageId }: Pick<InternalExecAgentParams, 'appContext' | 'parentMessageId'>,
): Promise<ResumeParentMessage> => {
  if (!parentMessageId) {
    throw new Error('parentMessageId is required when resume is true');
  }

  if (!appContext) {
    throw new Error('appContext is required when resume is true');
  }

  if (!appContext.topicId) {
    throw new Error('appContext.topicId is required when resume is true');
  }

  const resumeParentMessage = await deps.messageModel.findById(parentMessageId);

  if (!resumeParentMessage) {
    throw new Error(`Parent message not found: ${parentMessageId}`);
  }

  if (resumeParentMessage.topicId !== appContext.topicId) {
    throw new Error('appContext.topicId does not match parent message');
  }

  if (
    resumeParentMessage.threadId &&
    resumeParentMessage.threadId !== (appContext.threadId ?? undefined)
  ) {
    throw new Error('appContext.threadId does not match parent message');
  }

  if (resumeParentMessage.sessionId && resumeParentMessage.sessionId !== appContext.sessionId) {
    throw new Error('appContext.sessionId does not match parent message');
  }

  return resumeParentMessage;
};
