import { type ChatTopic } from '@/types/topic';

/**
 * State for the Task Manager right-side panel.
 *
 * Isolated from the main `useChatStore` so that switching/creating a Task
 * Manager topic does not mutate the main chat's `activeTopicId`.
 *
 * Messages are NOT duplicated here — they live in `useChatStore.dbMessagesMap`,
 * keyed by `messageMapKey(context)`. As long as the Task Manager uses its own
 * `activeTopicId` in the context it builds, the messages are naturally stored
 * under a different key.
 */
export interface TaskChatState {
  activeTopicId: string | null;
  /**
   * `undefined` means topics have not been fetched yet (loading state).
   */
  topics: ChatTopic[] | undefined;
}

export const initialState: TaskChatState = {
  activeTopicId: null,
  topics: undefined,
};
