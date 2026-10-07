import { useClientDataSWR } from '@/libs/swr';
import { topicService } from '@/services/topic';

/**
 * The conversation a case was captured from. The case stores only the topic
 * id; the topic carries the agent needed to build a link back to it.
 */
export const useSourceTopic = (topicId?: string | null) =>
  useClientDataSWR(topicId ? ['eval:caseSourceTopic', topicId] : null, async () => {
    const topic = await topicService.getTopicDetail(topicId!);
    return topic
      ? { agentId: (topic as { agentId?: string | null }).agentId ?? undefined, title: topic.title }
      : null;
  });
