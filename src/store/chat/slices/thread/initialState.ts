import { type IThreadType, type ThreadItem } from '@lobechat/types';
import { ThreadType } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface ChatThreadState {
  activeThreadId?: string;
  /**
   * is creating thread with service call
   */
  isCreatingThread?: boolean;
  isCreatingThreadMessage?: boolean;
  newThreadMode: IThreadType;
  /**
   * if true it mean to start to fork a new thread
   */
  startToForkThread?: boolean;

  threadInputMessage: string;
  threadListReplica: ReplicaState<ThreadItem[]>;
  threadLoadingIds: string[];
  /**
   * Threads by topic id, written only through the thread list replica. An
   * `undefined` entry means the topic's threads are not loaded yet.
   */
  threadMaps: Record<string, ThreadItem[]>;
  /**
   * when open thread creator, set the message id to it
   */
  threadStartMessageId?: string | null;
}

export const initialThreadState: ChatThreadState = {
  isCreatingThread: false,
  newThreadMode: ThreadType.Continuation,
  threadInputMessage: '',
  threadListReplica: createReplicaState<ThreadItem[]>(),
  threadLoadingIds: [],
  threadMaps: {},
};
