import { AGENT_DOCUMENT_DRAG_MIME } from '@lobechat/const';
import type React from 'react';

import { setDragLabelPreview } from '../ReferTopic/dragLabelPreview';

/** Payload carried when an agent document row is dragged into the chat input. */
export interface DocumentDragPayload {
  /** Agent-document binding id (`agent_documents.id`), as read by `readDocument`. */
  documentId: string;
  title: string;
}

/**
 * Write only our custom MIME — no `text/plain` fallback, which the Lexical chat
 * input would race to insert as text.
 */
export const writeDocumentDragData = (
  dataTransfer: DataTransfer,
  payload: DocumentDragPayload,
): void => {
  dataTransfer.setData(AGENT_DOCUMENT_DRAG_MIME, JSON.stringify(payload));
};

const FILE_TEXT_ICON_SVG =
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>';

/**
 * Start a document drag. The source tree also moves rows on drop, so keep
 * `copyMove`: the chat input accepts `copy`, the tree its own `move`.
 */
export const startDocumentDrag = (event: React.DragEvent, payload: DocumentDragPayload): void => {
  writeDocumentDragData(event.dataTransfer, payload);
  event.dataTransfer.effectAllowed = 'copyMove';
  setDragLabelPreview(event, { iconSvg: FILE_TEXT_ICON_SVG, label: payload.title });
};

export const readDocumentDragData = (
  dataTransfer: DataTransfer,
): DocumentDragPayload | undefined => {
  const raw = dataTransfer.getData(AGENT_DOCUMENT_DRAG_MIME);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<DocumentDragPayload>;
    if (typeof parsed.documentId !== 'string' || parsed.documentId.length === 0) return undefined;

    return {
      documentId: parsed.documentId,
      title:
        typeof parsed.title === 'string' && parsed.title.length > 0 ? parsed.title : 'Untitled',
    };
  } catch {
    return undefined;
  }
};
