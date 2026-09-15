import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * Fetch the active topic's detail when it is missing from the loaded list
 * bucket — e.g. an archived (`completed`) topic that the sidebar fetch
 * excludes via `excludeStatuses`, or a topic opened by URL whose page hasn't
 * been fetched. The result lands in `topicDetailMap`, which
 * `currentActiveTopic` reads as a fallback, so the header keeps the real
 * title instead of degrading to the "new topic" placeholder.
 *
 * Waits for the list bucket to load before deciding the topic is missing, so
 * the common case (topic present in the first page) never fires an extra
 * request.
 */
export const useFetchActiveTopicDetail = () => {
  const [activeTopicId, isMissingFromList, useFetchTopicDetail] = useChatStore((s) => [
    s.activeTopicId,
    !!s.activeTopicId &&
      !!topicSelectors.currentTopicData(s) &&
      !topicSelectors.currentTopics(s)?.some((topic) => topic.id === s.activeTopicId),
    s.useFetchTopicDetail,
  ]);

  useFetchTopicDetail(isMissingFromList ? activeTopicId : undefined);
};
