import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { hasLocalTopicRun } from '@/store/chat/slices/topic/topicDetail';
import { useServerConfigStore } from '@/store/serverConfig';

/**
 * Keep missing details available and discover runs started outside this client.
 * SCM can wake an idle, already-open topic without a frontend send. Poll its
 * detail until the normal gateway reconnect owns a local operation; that path
 * supplies streaming, the composer's Stop control, and terminal cleanup.
 */
export const useFetchActiveTopicDetail = () => {
  const [activeTopicId, isMissingFromList, useFetchTopicDetail] = useChatStore((s) => [
    s.activeTopicId,
    !!s.activeTopicId &&
      !!topicSelectors.currentTopicData(s) &&
      !topicSelectors.currentTopics(s)?.some((topic) => topic.id === s.activeTopicId),
    s.useFetchTopicDetail,
  ]);
  const gatewayEnabled = useServerConfigStore((s) => !!s.serverConfig.agentGatewayUrl);
  const watchRuns = useChatStore(
    (s) =>
      !!s.activeTopicId &&
      gatewayEnabled &&
      !s.creatingTopicIds.includes(s.activeTopicId) &&
      !hasLocalTopicRun(s, s.activeTopicId),
  );

  useFetchTopicDetail(isMissingFromList || watchRuns ? activeTopicId : undefined, watchRuns);
};
