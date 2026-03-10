import { type IThreadType, type ThreadItem } from '@lobechat/types';
import { ThreadType } from '@lobechat/types';

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
  threadLoadingIds: string[];
  threadMaps: Record<string, ThreadItem[]>;
  threadRenamingId?: string;
  threadsInit?: boolean;
  /**
   * when open thread creator, set the message id to it
   */
  threadStartMessageId?: string | null;
}

export const initialThreadState: ChatThreadState = {
  isCreatingThread: false,
  newThreadMode: ThreadType.Continuation,
  threadInputMessage: '',
  threadLoadingIds: [],
  threadMaps: {},
  threadsInit: false,
};
