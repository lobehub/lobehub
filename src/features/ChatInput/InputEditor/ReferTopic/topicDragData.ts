import { TOPIC_DRAG_MIME } from '@lobechat/const';
import type React from 'react';

import { setDragLabelPreview } from './dragLabelPreview';

export interface TopicDragPayload {
  topicId: string;
  topicTitle: string;
}

export const writeTopicDragData = (dataTransfer: DataTransfer, payload: TopicDragPayload): void => {
  dataTransfer.setData(TOPIC_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copy';
};

const TOPIC_ICON_SVG =
  '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8"/><path d="M8 13h6"/>';

export const startTopicDrag = (event: React.DragEvent, payload: TopicDragPayload): void => {
  writeTopicDragData(event.dataTransfer, payload);
  setDragLabelPreview(event, { iconSvg: TOPIC_ICON_SVG, label: payload.topicTitle });
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
