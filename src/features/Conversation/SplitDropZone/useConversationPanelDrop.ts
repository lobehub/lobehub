import { THREAD_DRAG_MIME, TOPIC_DRAG_MIME } from '@lobechat/const';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';

import { readThreadDragData } from '@/features/ChatInput/InputEditor/ReferTopic/threadDragData';
import { readTopicDragData } from '@/features/ChatInput/InputEditor/ReferTopic/topicDragData';
import { useChatStore } from '@/store/chat';

export type PanelDragKind = 'topic' | 'thread';

export const isChatInputDropTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest('[data-testid="chat-input"]'));

const resolveDragKind = (types: readonly string[]): PanelDragKind | null => {
  if (types.includes(TOPIC_DRAG_MIME)) return 'topic';
  if (types.includes(THREAD_DRAG_MIME)) return 'thread';
  return null;
};

interface UseConversationPanelDropResult {
  dragKind: PanelDragKind | null;
  onDragEnter: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDropCapture: (event: React.DragEvent) => void;
}

/**
 * Drop target for the main conversation column: dropping a sidebar topic or
 * thread here opens it side-by-side in the portal (a second conversation),
 * instead of the input's "refer topic" behaviour. The input owns TOPIC drops
 * over itself (it stops propagation), so those still insert a reference — only
 * drops on the conversation body reach here.
 */
export const useConversationPanelDrop = (): UseConversationPanelDropResult => {
  const [dragKind, setDragKind] = useState<PanelDragKind | null>(null);
  // dragenter/dragleave fire for every descendant; a depth counter keeps the
  // overlay stable until the pointer truly leaves the column.
  const depthRef = useRef(0);
  const [openTopicInPortal, openThreadInPortal] = useChatStore((s) => [
    s.openTopicInPortal,
    s.openThreadInPortal,
  ]);

  const onDragEnter = useCallback((event: React.DragEvent) => {
    const kind = resolveDragKind(event.dataTransfer.types);
    if (!kind) return;
    depthRef.current += 1;
    setDragKind(kind);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!resolveDragKind(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!resolveDragKind(event.dataTransfer.types)) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragKind(null);
  }, []);

  // Capture-phase reset: a drop on the nested composer is consumed there
  // (useTopicDrop stops propagation to insert a topic reference), so the
  // bubble-phase handler below never runs for it. Capture always fires first,
  // guaranteeing the overlay clears no matter which descendant owns the drop.
  const onDropCapture = useCallback((_event: React.DragEvent) => {
    depthRef.current = 0;
    setDragKind(null);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const kind = resolveDragKind(event.dataTransfer.types);
      if (!kind || isChatInputDropTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();

      if (kind === 'topic') {
        const payload = readTopicDragData(event.dataTransfer);
        if (payload) openTopicInPortal(payload.topicId);
        return;
      }

      const payload = readThreadDragData(event.dataTransfer);
      if (payload) openThreadInPortal(payload.threadId, payload.sourceMessageId);
    },
    [openTopicInPortal, openThreadInPortal],
  );

  return { dragKind, onDragEnter, onDragLeave, onDragOver, onDrop, onDropCapture };
};
