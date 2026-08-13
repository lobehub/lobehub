import { THREAD_DRAG_MIME } from '@lobechat/const';
import type React from 'react';

import { setDragLabelPreview } from './dragLabelPreview';

export interface ThreadDragPayload {
  sourceMessageId?: string;
  threadId: string;
  threadTitle: string;
}

export const writeThreadDragData = (
  dataTransfer: DataTransfer,
  payload: ThreadDragPayload,
): void => {
  dataTransfer.setData(THREAD_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copy';
};

// lucide `CornerDownRight` — the same glyph the thread rows use in the sidebar.
const THREAD_ICON_SVG = '<path d="m15 10 5 5-5 5"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>';

export const startThreadDrag = (event: React.DragEvent, payload: ThreadDragPayload): void => {
  writeThreadDragData(event.dataTransfer, payload);
  setDragLabelPreview(event, { iconSvg: THREAD_ICON_SVG, label: payload.threadTitle });
};

export const readThreadDragData = (dataTransfer: DataTransfer): ThreadDragPayload | undefined => {
  const raw = dataTransfer.getData(THREAD_DRAG_MIME);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<ThreadDragPayload>;
    if (typeof parsed.threadId !== 'string' || parsed.threadId.length === 0) return undefined;

    return {
      sourceMessageId:
        typeof parsed.sourceMessageId === 'string' ? parsed.sourceMessageId : undefined,
      threadId: parsed.threadId,
      threadTitle:
        typeof parsed.threadTitle === 'string' && parsed.threadTitle.length > 0
          ? parsed.threadTitle
          : 'Untitled',
    };
  } catch {
    return undefined;
  }
};
