/* eslint-disable typescript-sort-keys/interface */
import { CreateMessageParams } from '@lobechat/types';

import { CreateThreadParams, ThreadItem } from '@/types/topic';

interface CreateThreadWithMessageParams extends CreateThreadParams {
  message: CreateMessageParams;
}

export interface IThreadService {
  getThreads(topicId: string): Promise<ThreadItem[]>;

  createThreadWithMessage({
    message,
    ...params
  }: CreateThreadWithMessageParams): Promise<{ messageId: string; threadId: string }>;

  updateThread(id: string, data: Partial<ThreadItem>): Promise<any>;
  //
  removeThread(id: string): Promise<any>;
}
