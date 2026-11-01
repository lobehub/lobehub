import useSWR from 'swr';

import { scmKeys } from '@/libs/swr/keys';
import { scmService } from '@/services/scm';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { hasLocalTopicRun } from '@/store/chat/slices/topic/topicDetail';
import { useServerConfigStore } from '@/store/serverConfig';

/**
 * Keep missing details available and discover runs started outside this client.
 * SCM can wake an idle, already-open topic without a frontend send. Poll its
 * detail until the normal gateway reconnect owns a local operation; that path
 * supplies streaming, the composer's Stop control, and terminal cleanup.
 *
 * Polling is armed only while a review or CI event can still wake the topic.
 * That check re-runs on entry, on focus, and after each local run, which is
 * when the agent may have opened a pull request.
 */
export const useFetchActiveTopicDetail = () => {
  const [activeTopicId, isMissingFromList, useFetchTopicDetail] = useChatStore((s) => [
    s.activeTopicId,
    !!s.activeTopicId &&
      !s.creatingTopicIds.includes(s.activeTopicId) &&
      !topicSelectors.currentTopics(s)?.some((topic) => topic.id === s.activeTopicId),
    s.useFetchTopicDetail,
  ]);
  const gatewayEnabled = useServerConfigStore((s) => !!s.serverConfig.agentGatewayUrl);
  const idle = useChatStore(
    (s) =>
      !!s.activeTopicId &&
      gatewayEnabled &&
      !s.creatingTopicIds.includes(s.activeTopicId) &&
      !hasLocalTopicRun(s, s.activeTopicId),
  );
  const { data: wakeable } = useSWR(
    idle && activeTopicId ? scmKeys.wakeTarget(activeTopicId) : null,
    () => scmService.hasWakeTarget(activeTopicId!),
    { shouldRetryOnError: false },
  );
  const watchRuns = idle && !!wakeable;

  // Revalidate on entry even when a persisted row exists: SCM wakeability does
  // not describe runs already active on the server after a reload. Only SCM
  // wake targets need continued polling once that first read has settled.
  useFetchTopicDetail(isMissingFromList || idle ? activeTopicId : undefined, watchRuns);
};
