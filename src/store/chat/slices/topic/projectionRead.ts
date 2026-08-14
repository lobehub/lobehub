import { isDesktop } from '@lobechat/const';
import { getWorkingDirEffectivePath } from '@lobechat/types';

import { getChatProjection } from '@/projection/modules/chat/read';
import {
  selectChatTopicContainerKeyById,
  selectChatTopicItem,
  selectChatTopicsView,
} from '@/projection/modules/chat/selectors';
import type { ChatTopic } from '@/types/topic';

import { topicMapKey } from '../../utils/topicMapKey';

/**
 * Store-independent Topic Projection reads.
 *
 * Chat-store slices must import from this module instead of `./projection`.
 * The latter also exposes React hooks and current-topic helpers, which import
 * the chat store and therefore form an initialization cycle while the store is
 * being composed.
 */
export const getChatTopicById = (id: string | undefined): ChatTopic | undefined =>
  id ? getChatProjection((scope) => selectChatTopicItem(scope, id)) : undefined;

export const getChatTopicContainerKeyById = (id: string): string | undefined =>
  getChatProjection((scope) => selectChatTopicContainerKeyById(scope, id));

export const getChatTopics = (
  containerKey: string,
  surface: 'agentView' | 'sidebar' = 'sidebar',
): ChatTopic[] | undefined =>
  getChatProjection((scope) => selectChatTopicsView(scope, surface, containerKey)?.items);

export const getChatTopicsByAgentId = (agentId: string): ChatTopic[] | undefined =>
  getChatTopics(topicMapKey({ agentId }));

export const getChatTopicModelById = (
  id: string | undefined,
): { model: string; provider: string } | undefined => {
  const topic = getChatTopicById(id);
  if (!topic?.model) return undefined;
  return { model: topic.model, provider: topic.provider || '' };
};

export const extractChatTopicWorkingDirectory = (
  topic: ChatTopic | undefined,
): string | undefined => {
  if (!topic) return undefined;
  if (isDesktop) {
    return getWorkingDirEffectivePath(
      topic.metadata?.workingDirectoryConfig ?? topic.metadata?.workingDirectory,
    );
  }

  const metadata = topic.metadata;
  return (
    metadata?.repos?.[0] ??
    getWorkingDirEffectivePath(metadata?.workingDirectoryConfig ?? metadata?.workingDirectory)
  );
};

export const getChatTopicWorkingDirectoryById = (
  id: string | null | undefined,
): string | undefined => (id ? extractChatTopicWorkingDirectory(getChatTopicById(id)) : undefined);
