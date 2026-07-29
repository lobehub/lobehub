import { WORKSPACE_FILE_DRAG_MIME } from '@lobechat/const';
import { cssVar } from 'antd-style';
import type React from 'react';

/**
 * Payload serialized into the drag `dataTransfer` when a file/folder row is
 * dragged out of the working sidebar tree. Mirrors the `localFile` mention
 * metadata so the drop handler can dispatch `INSERT_MENTION_COMMAND` directly.
 */
export interface WorkspaceFileDragPayload {
  isDirectory: boolean;
  /** Display name (basename) shown on the mention chip. */
  name: string;
  /** Absolute path on the working device's filesystem. */
  path: string;
}

/**
 * Write only our custom MIME — no `text/plain` fallback. The Lexical chat input
 * reacts to `text/plain` drops and would race with the drop handler. Mark the
 * drag as `copy` so the input can accept it even though the source tree is not a
 * reorder target (the working files panel has no `onMove`).
 */
export const writeWorkspaceFileDragData = (
  dataTransfer: DataTransfer,
  payload: WorkspaceFileDragPayload,
): void => {
  dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copy';
};

export const readWorkspaceFileDragData = (
  dataTransfer: DataTransfer,
): WorkspaceFileDragPayload | undefined => {
  const raw = dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceFileDragPayload>;
    if (!parsed || typeof parsed.path !== 'string' || parsed.path.length === 0) {
      return undefined;
    }
    return {
      isDirectory: !!parsed.isDirectory,
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.path,
      path: parsed.path,
    };
  } catch {
    return undefined;
  }
};

/**
 * Resolve a `var(--x)` reference (e.g. from antd-style `cssVar.*`) to its
 * concrete computed value in the context of `ctx`. Lets the drag preview live on
 * `document.body` (free of transformed ancestors that would break fixed-position
 * cursor tracking) while still picking up the themed token. Mirrors the skill
 * drag chip in `ActionTag/skillDragData.ts`.
 */
const resolveCssVar = (ref: string, ctx: Element): string => {
  const name = /var\((--[^\s),]+)/.exec(ref)?.[1];
  if (!name) return ref;
  return getComputedStyle(ctx).getPropertyValue(name).trim() || ref;
};

/** Vertical gap between the cursor and the bottom of the floating chip. */
const DRAG_GAP = 0;

const dragTransform = (x: number, y: number) =>
  `translate(${x}px, ${y}px) translate(-50%, calc(-100% - ${DRAG_GAP}px))`;

// Inline lucide `File` / `Folder` glyphs so the preview never depends on cloning
// the pierre/trees row icon out of its shadow DOM.
const FILE_ICON_SVG =
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>';
const FOLDER_ICON_SVG =
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>';

const buildIconSvg = (isDirectory: boolean, color: string): SVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color);
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flexShrink = '0';
  svg.innerHTML = isDirectory ? FOLDER_ICON_SVG : FILE_ICON_SVG;
  return svg;
};

/**
 * Render a custom "icon + name" chip that follows the cursor during a
 * workspace-file drag, matching the skill drag preview. Suppresses the browser's
 * native drag image (a bitmap the OS draws with its own shadow) via an invisible
 * 1×1 ghost, then tracks the cursor through the document-level `dragover` event
 * (`drag` reports 0,0 in Chromium).
 */
const setWorkspaceFileDragImage = (
  event: React.DragEvent,
  payload: WorkspaceFileDragPayload,
): void => {
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

  preview.append(buildIconSvg(payload.isDirectory, resolveCssVar(cssVar.colorTextTertiary, host)));

  const text = document.createElement('span');
  text.textContent = payload.name;
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
  host.addEventListener('dragend', cleanup as EventListener, { once: true });
};

/** Start a workspace-file drag: write the payload and swap in the custom chip. */
export const startWorkspaceFileDrag = (
  event: React.DragEvent,
  payload: WorkspaceFileDragPayload,
): void => {
  writeWorkspaceFileDragData(event.dataTransfer, payload);
  setWorkspaceFileDragImage(event, payload);
};
