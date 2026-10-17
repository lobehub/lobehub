import { shallow } from 'zustand/shallow';

import type { ChatStoreState } from '../../initialState';
import { topicSelectors } from './selectors';

interface SelectorSubscribableStore {
  getState: () => ChatStoreState;
  setState: (partial: Partial<ChatStoreState>, replace?: false, action?: string) => void;
  subscribe: <U>(
    selector: (state: ChatStoreState) => U,
    listener: (selected: U, previous: U) => void,
    options?: { equalityFn?: (a: U, b: U) => boolean },
  ) => () => void;
}

/**
 * Maintains `justArchivedTopicId`: the active topic is recorded when its status
 * turns `completed` while it stays active (sidebar menu, topic header, bulk
 * "archive merged PRs"…), and cleared once the user moves to another topic or
 * the topic leaves `completed` again (restore, rolled-back optimistic archive).
 * Watching the transition rather than each archive action covers every write
 * path, including optimistic overlays.
 */
export const subscribeJustArchivedTopic = (store: SelectorSubscribableStore): (() => void) =>
  store.subscribe(
    (s) => [s.activeTopicId, topicSelectors.currentActiveTopic(s)?.status] as const,
    ([topicId, status], [prevTopicId, prevStatus]) => {
      const { justArchivedTopicId } = store.getState();

      if (topicId !== prevTopicId) {
        if (justArchivedTopicId)
          store.setState({ justArchivedTopicId: undefined }, false, 'clearJustArchivedTopic');
        return;
      }

      // Restored (or an optimistic archive rolled back): pin it again. An
      // unknown status is not a restore — the list refresh after archiving
      // drops the row until its detail loads back as `completed`.
      if (justArchivedTopicId === topicId && status && status !== 'completed') {
        store.setState({ justArchivedTopicId: undefined }, false, 'clearJustArchivedTopic');
        return;
      }

      // `prevStatus` is undefined while the topic is still loading, so a topic
      // opened already archived keeps its pinned row.
      if (topicId && status === 'completed' && prevStatus && prevStatus !== 'completed')
        store.setState({ justArchivedTopicId: topicId }, false, 'markJustArchivedTopic');
    },
    { equalityFn: shallow },
  );
