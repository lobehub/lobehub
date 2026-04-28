import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

const EXCLUDE_STATUSES_COMPLETED = ['completed'];
const EXCLUDE_TRIGGERS = ['cron', 'eval'];

/**
 * Canonical topic fetch for chat sidebars (agent + group). Reads every
 * filter from a single source so all call sites in the same route mount
 * the same SWR key — otherwise two sibling `useFetchTopics()` calls with
 * different args both write to `topicDataMap[containerKey]` and whichever
 * response lands last wins, which is how completed topics used to leak
 * into the list despite the `excludeStatuses` filter.
 *
 * Extend this hook when adding more preference-driven topic params; don't
 * spread them across individual components.
 */
export const useFetchChatTopics = () => {
  const includeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);

  return useFetchTopics({
    excludeStatuses: includeCompleted ? undefined : EXCLUDE_STATUSES_COMPLETED,
    excludeTriggers: EXCLUDE_TRIGGERS,
  });
};
