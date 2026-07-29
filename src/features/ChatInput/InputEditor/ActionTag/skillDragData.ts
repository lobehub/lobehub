import { SKILL_DRAG_MIME } from '@lobechat/const';
import { cssVar } from 'antd-style';
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
 * Write only our custom MIME — no `text/plain` fallback. The Lexical chat
 * input reacts to `text/plain` drops and would race with `useSkillDrop`,
 * breaking every skill drag. Drops on non-editor targets silently do nothing.
 */
export const writeSkillDragData = (dataTransfer: DataTransfer, payload: SkillDragPayload): void => {
  dataTransfer.setData(SKILL_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copy';
};

/**
 * Resolve a `var(--x)` reference (e.g. from antd-style `cssVar.*`) to its
 * concrete computed value in the context of `ctx`. Lets the drag preview live
 * on `document.body` (free of transformed ancestors that would break
 * fixed-position cursor tracking) while still picking up the themed token.
 */
const resolveCssVar = (ref: string, ctx: Element): string => {
  const name = /var\((--[^\s),]+)/.exec(ref)?.[1];
  if (!name) return ref;
  return getComputedStyle(ctx).getPropertyValue(name).trim() || ref;
};

/** Vertical gap between the cursor and the bottom of the floating chip. */
const DRAG_GAP = 0;

/**
 * Position the chip centered horizontally on the cursor and floating just above
 * it. The trailing `translate(-50%, -100%)` shifts the element by its own size,
 * so it works regardless of the chip's width/height.
 */
const dragTransform = (x: number, y: number) =>
  `translate(${x}px, ${y}px) translate(-50%, calc(-100% - ${DRAG_GAP}px))`;

/**
 * Render a custom "icon + name" chip that follows the cursor during the drag.
 *
 * We suppress the browser's native drag image (a bitmap snapshot the OS draws
 * with its own drop shadow / rounding that no CSS can remove) by handing
 * `setDragImage` an invisible 1×1 element, then position our own element under
 * the cursor via the document-level `dragover` event — the `drag` event reports
 * 0,0 coordinates in Chrome, so it can't be used for tracking.
 *
 * The skill icon is cloned from the dragged row so the chip stays faithful to
 * whichever group rendered it.
 */
const setSkillDragImage = (event: React.DragEvent, label: string): void => {
  if (typeof document === 'undefined') return;

  const host = event.currentTarget;

  // Suppress the native drag image with an invisible ghost.
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
    border: `1px solid ${resolveCssVar(cssVar.colorBorderSecondary, host)}`,
    borderRadius: '10px',
    color: resolveCssVar(cssVar.colorText, host),
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
    transform: dragTransform(event.clientX, event.clientY),
    whiteSpace: 'nowrap',
    zIndex: '9999',
  });

  // Row layout is: [chevron svg] [skill icon svg] [name] [count] [row actions].
  // The hover action buttons (view / rename / delete) stay in the DOM even when
  // hidden, so exclude them before taking the last svg — otherwise we'd grab the
  // trailing Trash2 action icon instead of the skill icon.
  const svgs = Array.from(host.querySelectorAll('svg')).filter(
    (svg) => !svg.closest('.skill-row-actions'),
  );
  const iconSvg = svgs.at(-1);
  if (iconSvg) {
    const iconClone = iconSvg.cloneNode(true) as SVGElement;
    iconClone.style.flexShrink = '0';
    iconClone.style.color = resolveCssVar(cssVar.colorTextTertiary, host);
    preview.append(iconClone);
  }

  const text = document.createElement('span');
  text.textContent = label;
  text.style.overflow = 'hidden';
  text.style.textOverflow = 'ellipsis';
  preview.append(text);

  document.body.append(preview);

  const move = (e: DragEvent) => {
    preview.style.transform = dragTransform(e.clientX, e.clientY);
  };
  const cleanup = () => {
    document.removeEventListener('dragover', move);
    preview.remove();
    ghost.remove();
  };

  document.addEventListener('dragover', move);
  host.addEventListener('dragend', cleanup, { once: true });
};

/**
 * Start a skill drag: write the payload and swap in the custom drag image.
 */
export const startSkillDrag = (event: React.DragEvent, payload: SkillDragPayload): void => {
  writeSkillDragData(event.dataTransfer, payload);
  setSkillDragImage(event, payload.label);
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
