import { cssVar } from 'antd-style';
import type React from 'react';

const resolveCssVar = (ref: string, context: Element): string => {
  const name = /var\((--[^\s),]+)/.exec(ref)?.[1];
  if (!name) return ref;
  return getComputedStyle(context).getPropertyValue(name).trim() || ref;
};

/**
 * Replaces the browser's default drag ghost with a floating labelled pill that
 * tracks the cursor — shared by the topic and thread sidebar drags so both read
 * the same way. `iconSvg` is the inner markup of a 24×24 lucide icon.
 */
export const setDragLabelPreview = (
  event: React.DragEvent,
  { iconSvg, label }: { iconSvg: string; label: string },
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
  icon.innerHTML = iconSvg;
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
