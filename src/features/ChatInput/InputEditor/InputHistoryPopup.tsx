import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import type { ChatInputHistoryEntry } from '../inputHistoryStorage';

const styles = stylex.create({
  item: {
    cursor: 'pointer',
    overflow: 'hidden',
    paddingBlock: '6px',
    paddingInline: '10px',
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    transition: `background 0.1s ${cssVar.motionEaseOut}`,
  },
  itemActive: {
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  root: {
    position: 'absolute',
    zIndex: 50,
    insetBlockEnd: 'calc(100% + 8px)',
    insetInline: '0',
    overflowY: 'auto',
    maxHeight: '240px',
    padding: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
});

/**
 * Normalize a stored markdown prompt into a single-line plain-text preview for
 * both the popup rows and the inline ghost placeholder. Rich-input tags are
 * collapsed to readable mentions so the preview stays scannable.
 */
export const getHistoryPreviewText = (markdown: string): string =>
  markdown
    .replaceAll(/<mention\s[^>]*name="([^"]*)"[^>]*>/g, '@$1')
    .replaceAll(/<refer_topic\s[^>]*name="([^"]*)"[^>]*>/g, '#$1')
    .replaceAll(/<localFile\s[^>]*name="([^"]*)"[^>]*>/g, '$1')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

interface InputHistoryPopupProps {
  activeIndex: number;
  container: HTMLElement | null;
  entries: ChatInputHistoryEntry[];
  onClose: () => void;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  open: boolean;
}

const InputHistoryPopup = memo<InputHistoryPopupProps>(
  ({ activeIndex, container, entries, onClose, onHover, onSelect, open }) => {
    const rootRef = useRef<HTMLDivElement>(null);

    // Close when clicking outside the popup. The editor itself counts as
    // "outside" — clicking back into the editor dismisses history navigation.
    useEffect(() => {
      if (!open) return;
      const handlePointerDown = (event: MouseEvent) => {
        if (rootRef.current?.contains(event.target as Node)) return;
        onClose();
      };
      document.addEventListener('mousedown', handlePointerDown);
      return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [open, onClose]);

    // Keep the highlighted row visible during keyboard navigation.
    useEffect(() => {
      if (!open) return;
      const node = rootRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
      node?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, open]);

    if (!open || !container || entries.length === 0) return null;

    // Render the most recent entry nearest the input (bottom of the list that
    // grows upward above the editor).
    const indices = entries.map((_, index) => index).reverse();

    return createPortal(
      <div {...stylex.props(styles.root)} ref={rootRef}>
        {indices.map((index) => {
          const entry = entries[index];
          return (
            <div
              {...stylex.props(styles.item, index === activeIndex && styles.itemActive)}
              data-index={index}
              key={`${entry.createdAt}-${index}`}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                // Prevent the editor blur so onSelect can restore content and
                // refocus without a focus flicker.
                event.preventDefault();
                onSelect(index);
              }}
            >
              {getHistoryPreviewText(entry.markdown) || ' '}
            </div>
          );
        })}
      </div>,
      container,
    );
  },
);

InputHistoryPopup.displayName = 'InputHistoryPopup';

export default InputHistoryPopup;
