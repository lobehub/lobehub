import { TOPIC_DRAG_MIME } from '@lobechat/const';
import { cssVar } from 'antd-style';
import type React from 'react';

export interface TopicDragPayload {
  topicId: string;
  topicTitle: string;
}

export const writeTopicDragData = (dataTransfer: DataTransfer, payload: TopicDragPayload): void => {
  dataTransfer.setData(TOPIC_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copy';
};

const resolveCssVar = (ref: string, context: Element): string => {
  const name = /var\((--[^\s),]+)/.exec(ref)?.[1];
  if (!name) return ref;
  return getComputedStyle(context).getPropertyValue(name).trim() || ref;
};

const TOPIC_ICON_SVG =
  '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8"/><path d="M8 13h6"/>';

const setTopicDragImage = (event: React.DragEvent, label: string): void => {
  if (typeof document === 'undefined') return;

  const host = event.currentTarget as Element;
  const ghost = document.createElement('div');
  Object.assign(ghost.style, {
    height: '1px',
    left: '-9999px',
    opacity: '0',
    position: 'fixed',
    top: '-9999px',
    width: '1px',
  });
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, 0, 0);

  const preview = document.createElement('div');
  Object.assign(preview.style, {
    alignItems: 'center',
    background: resolveCssVar(cssVar.colorBgElevated, host),
    border: `1px solid ${resolveCssVar(cssVar.colorInfoBorder, host)}`,
    borderRadius: '10px',
    color: resolveCssVar(cssVar.colorInfo, host),
    display: 'inline-flex',
    fontSize: '13px',
    gap: '8px',
    left: '0',
    lineHeight: '1',
    maxWidth: '280px',
    padding: '8px 14px',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    transform: `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -100%)`,
    whiteSpace: 'nowrap',
    zIndex: '9999',
  });

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.innerHTML = TOPIC_ICON_SVG;
  preview.append(icon);

  const text = document.createElement('span');
  text.textContent = label;
  text.style.overflow = 'hidden';
  text.style.textOverflow = 'ellipsis';
  preview.append(text);
  document.body.append(preview);

  const move = (dragEvent: DragEvent) => {
    preview.style.transform = `translate(${dragEvent.clientX}px, ${dragEvent.clientY}px) translate(-50%, -100%)`;
  };
  const cleanup = () => {
    document.removeEventListener('dragover', move);
    preview.remove();
    ghost.remove();
  };

  document.addEventListener('dragover', move);
  host.addEventListener('dragend', cleanup as EventListener, { once: true });
};

export const startTopicDrag = (event: React.DragEvent, payload: TopicDragPayload): void => {
  writeTopicDragData(event.dataTransfer, payload);
  setTopicDragImage(event, payload.topicTitle);
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
