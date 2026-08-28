import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { createTopicCommentSlice, type TopicCommentAction } from './action';
import { initialState, type TopicCommentState } from './initialState';

export type TopicCommentStore = TopicCommentAction & TopicCommentState & ResetableStore;

class TopicCommentStoreResetAction extends ResetableStoreAction<TopicCommentStore> {
  protected readonly resetActionName = 'resetTopicCommentStore';
}

const createStore: StateCreator<TopicCommentStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<TopicCommentStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<TopicCommentAction & ResetableStore>([
    createTopicCommentSlice(...parameters),
    new TopicCommentStoreResetAction(...parameters),
  ]),
});

const devtools = createDevtools('topicComment');

export const useTopicCommentStore = createWithEqualityFn<TopicCommentStore>()(
  devtools(createStore),
  shallow,
);

expose('topicComment', useTopicCommentStore);
