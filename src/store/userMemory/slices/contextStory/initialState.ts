import { type MemoryContextStory, type MemoryContextStoryList } from '@lobechat/types';

export interface ContextStorySliceState {
  /** Story cards of the contexts page; `undefined` until the first response. */
  contextStoryList?: MemoryContextStoryList;
  /** One story page per context id; `null` when the id is not a consolidated context. */
  contextStoryMap: Record<string, MemoryContextStory | null>;
}

export const contextStoryInitialState: ContextStorySliceState = {
  contextStoryMap: {},
};
