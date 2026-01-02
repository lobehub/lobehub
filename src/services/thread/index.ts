import { type CreateMessageParams } from '@lobechat/types';

import { INBOX_SESSION_ID } from '@/const/session';
import { lambdaClient } from '@/libs/trpc/client';
import { type CreateThreadParams, type ThreadItem } from '@/types/topic';

interface CreateThreadWithMessageParams extends CreateThreadParams {
  message: CreateMessageParams;
}

export class ThreadService {
  getThreads = (topicId: string): Promise<ThreadItem[]> => {
    return lambdaClient.thread.getThreads.query({ topicId });
  };

  createThreadWithMessage = async ({
    message,
    ...params
  }: CreateThreadWithMessageParams): Promise<{ messageId: string; threadId: string }> => {
    return lambdaClient.thread.createThreadWithMessage.mutate({
      ...params,
      message: { ...message, sessionId: this.toDbSessionId(message.sessionId) },
    });
  };

  updateThread = async (id: string, data: Partial<ThreadItem>) => {
    return lambdaClient.thread.updateThread.mutate({ id, value: data });
  };

  removeThread = async (id: string) => {
    return lambdaClient.thread.removeThread.mutate({ id });
  };

  private toDbSessionId = (sessionId: string | undefined) => {
    return sessionId === INBOX_SESSION_ID ? null : sessionId;
  };
}

export const threadService = new ThreadService();
