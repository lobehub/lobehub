import { TOPIC_DRAG_MIME } from '@lobechat/const';

export interface TopicDragPayload {
  topicId: string;
  topicTitle: string;
}

export const writeTopicDragData = (dataTransfer: DataTransfer, payload: TopicDragPayload): void => {
  dataTransfer.setData(TOPIC_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copy';
};

export const readTopicDragData = (dataTransfer: DataTransfer): TopicDragPayload | undefined => {
  const raw = dataTransfer.getData(TOPIC_DRAG_MIME);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<TopicDragPayload>;
    if (typeof parsed.topicId !== 'string' || parsed.topicId.length === 0) return undefined;

    return {
      topicId: parsed.topicId,
      topicTitle:
        typeof parsed.topicTitle === 'string' && parsed.topicTitle.length > 0
          ? parsed.topicTitle
          : 'Untitled',
    };
  } catch {
    return undefined;
  }
};
