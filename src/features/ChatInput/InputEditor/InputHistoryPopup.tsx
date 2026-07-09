import { createStaticStyles, cx } from 'antd-style';
import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import type { ChatInputHistoryEntry } from '../inputHistoryStorage';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    cursor: pointer;

    overflow: hidden;

    padding-block: 6px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    transition: background 0.1s ${cssVar.motionEaseOut};
  `,
  itemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  root: css`
    position: absolute;
    z-index: 50;
    inset-block-end: calc(100% + 8px);
    inset-inline: 0;

    overflow-y: auto;

    max-height: 240px;
    padding: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
}));

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
      <div className={styles.root} ref={rootRef}>
        {indices.map((index) => {
          const entry = entries[index];
          return (
            <div
              className={cx(styles.item, index === activeIndex && styles.itemActive)}
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
