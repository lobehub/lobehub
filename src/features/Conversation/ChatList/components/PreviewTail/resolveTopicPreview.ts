import { getValidTopicPreview, type TopicPreview } from '@/services/message/topicPreview';

import { hasReadingPositionSnapshot } from '../../utils/scrollSnapshotStore';

export const resolveTopicPreview = ({
  contextKey,
  running,
  topicId,
  topicUpdatedAt,
}: {
  contextKey: string;
  running: boolean;
  topicId?: string | null;
  topicUpdatedAt?: Date | string | number | null;
}): TopicPreview | undefined => {
  if (!topicId) return undefined;
  const preview = getValidTopicPreview(topicId, { running, topicUpdatedAt });
  // The preview only paints the bottom of the list; a saved reading position opens elsewhere.
  if (!preview || hasReadingPositionSnapshot(contextKey)) return undefined;
  return preview;
};
