import type { ArtboardCommentThreadView } from '@lobechat/types';

import { isAnswered, isQuestion } from '../data/commentModel';

export const PIN_SIZE = 28;
const POPOVER_WIDTH = 300;
const POPOVER_MAX_HEIGHT = 420;
const PIN_GAP = 14;
const EDGE = 12;
const TOP_INSET = 64;

export interface PopoverBox {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

export const popoverBox = (
  pin: { x: number; y: number },
  size: { height: number; width: number },
  measuredHeight: number,
): PopoverBox => {
  const width = Math.max(0, Math.min(POPOVER_WIDTH, size.width - EDGE * 2));
  const right = pin.x + PIN_SIZE + PIN_GAP;
  const preferred = right + width > size.width - EDGE ? pin.x - PIN_GAP - width : right;
  const left = Math.max(EDGE, Math.min(preferred, size.width - width - EDGE));
  const topInset = Math.min(TOP_INSET, Math.max(0, size.height - EDGE));
  const maxHeight = Math.max(0, Math.min(POPOVER_MAX_HEIGHT, size.height - topInset - EDGE));
  const shown = Math.min(measuredHeight, maxHeight);
  const top = Math.max(topInset, Math.min(pin.y - PIN_SIZE, size.height - shown - EDGE));
  return { left, maxHeight, top, width };
};

const timeOf = (value: Date | string) => new Date(value).getTime();

export const threadNumbers = (threads: ArtboardCommentThreadView[]) =>
  new Map(
    threads
      .toSorted((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt))
      .map((thread, index) => [thread.id, index + 1] as const),
  );

export type PinTone = 'default' | 'resolved' | 'stale' | 'waiting';

export const pinTone = (thread: ArtboardCommentThreadView): PinTone => {
  if (thread.resolvedAt) return 'resolved';
  if (thread.stale) return 'stale';
  if (isQuestion(thread) && !isAnswered(thread)) return 'waiting';
  return 'default';
};
