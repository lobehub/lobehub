import { SKILL_DRAG_MIME } from '@lobechat/const';
import type React from 'react';

import type { ActionTagCategory, ActionTagType } from './types';

/**
 * Payload serialized into the drag `dataTransfer`. Mirrors the action-tag node
 * fields so the drop handler can dispatch `INSERT_ACTION_TAG_COMMAND` directly.
 */
export interface SkillDragPayload {
  category: ActionTagCategory;
  label: string;
  type: ActionTagType;
}

/**
 * Write only our custom MIME — no `text/plain` fallback. Earlier versions also
 * set `text/plain` to the label so the chip degraded to text when dropped on
 * non-editor targets, but the Lexical chat input also reacts to `text/plain`
 * drops and would race / suppress our `useSkillDrop` handler, breaking every
 * skill drag. Drops on non-editor targets silently do nothing instead.
 */
export const writeSkillDragData = (dataTransfer: DataTransfer, payload: SkillDragPayload): void => {
  dataTransfer.setData(SKILL_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copy';
};

/**
 * Kick off a skill drag. The native browser drag image is fine — earlier we
 * tried suppressing it with an invisible ghost + a cursor-following preview to
 * dodge the OS drop shadow, but that interfered with the dragstart sequence on
 * some setups and broke the drag entirely. Reverting to the native image keeps
 * the chain reliable; we can revisit the cosmetic shadow problem separately.
 */
export const startSkillDrag = (event: React.DragEvent, payload: SkillDragPayload): void => {
  writeSkillDragData(event.dataTransfer, payload);
};

export const readSkillDragData = (dataTransfer: DataTransfer): SkillDragPayload | undefined => {
  const raw = dataTransfer.getData(SKILL_DRAG_MIME);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<SkillDragPayload>;
    if (!parsed || typeof parsed.type !== 'string' || typeof parsed.category !== 'string') {
      return undefined;
    }
    return {
      category: parsed.category,
      label: typeof parsed.label === 'string' ? parsed.label : parsed.type,
      type: parsed.type,
    };
  } catch {
    return undefined;
  }
};
