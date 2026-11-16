'use client';

import { $isListItemNode, type ListItemNode } from '@lexical/list';
import {
  $continueListNumbering,
  $getListNumbering,
  $setListItemNumber,
  type ListNumbering,
} from '@lobechat/editor-runtime';
import type { IEditor } from '@lobehub/editor';
import { Button, Flexbox, InputNumber, Popover, Text, Tooltip } from '@lobehub/ui';
import { cssVar as vars } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { $getNearestNodeFromDOMNode, $getNodeByKey } from 'lexical';
import { type CSSProperties, memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { findOrderedItemNear } from './markerHitTest';
import { onListNumberMenuRequest } from './numberMenuRequest';

const styles = stylex.create({
  item: { justifyContent: 'flex-start', paddingInline: 8 },
  // The popover anchors to this box, so it carries the position.
  anchor: { display: 'block', position: 'fixed', zIndex: 10 },
  marker: {
    // The button only exists while the number is hovered.
    backgroundColor: vars.colorPrimaryBgHover,
    borderRadius: vars.borderRadiusSM,
    borderStyle: 'none',
    cursor: 'pointer',
    display: 'block',
    height: '100%',
    paddingBlock: 0,
    paddingInlineStart: 0,
    textAlign: 'end',
    whiteSpace: 'nowrap',
    width: '100%',
  },
  valueRow: { paddingBlock: 4, paddingInline: 8 },
});

interface MarkerRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface Marker {
  key: string;
  label: string;
  rect: MarkerRect;
  style: CSSProperties;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

const measure = (text: string, font: string, fallback: number) => {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return fallback;
  measureContext.font = font;
  return measureContext.measureText(text).width;
};

/**
 * The `::marker` box is not in the DOM and cannot take a background, so the
 * button covering it redraws the number: same box, font and color, on top of
 * the highlight.
 */
const getMarker = (li: HTMLLIElement): Omit<Marker, 'key'> => {
  const range = document.createRange();
  range.selectNodeContents(li);
  const itemRect = li.getBoundingClientRect();
  const line = range.getClientRects()[0] ?? itemRect;
  const itemStyle = getComputedStyle(li);
  const markerStyle = getComputedStyle(li, '::marker');
  const fontSize = Number.parseFloat(itemStyle.fontSize);
  const font = `${itemStyle.fontWeight} ${itemStyle.fontSize} ${itemStyle.fontFamily}`;

  const label = `${li.value}.`;
  // The marker reads "1. " and ends where the item's text starts.
  const gap = measure(' ', font, fontSize * 0.3);
  const width = measure(label, font, fontSize) + gap + 6;

  return {
    label,
    rect: { height: line.height, left: itemRect.left - width, top: line.top, width },
    style: {
      color: markerStyle.color,
      fontFamily: itemStyle.fontFamily,
      fontSize: itemStyle.fontSize,
      fontWeight: itemStyle.fontWeight as CSSProperties['fontWeight'],
      lineHeight: `${line.height}px`,
      paddingInlineEnd: gap,
    },
  };
};

const contains = (rect: MarkerRect, x: number, y: number) =>
  x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;

const findMarkerItem = (root: HTMLElement, x: number, y: number) => {
  const bounds = root.getBoundingClientRect();
  // Markers hang outside the item, up to a few characters left of the root.
  if (y < bounds.top || y > bounds.bottom || x < bounds.left - 64 || x > bounds.right) return;

  const li = findOrderedItemNear(root, x, y);
  if (!li) return;
  const marker = getMarker(li);
  if (contains(marker.rect, x, y)) return { li, marker };
};

/**
 * Applies a valid number typed in the menu. The Enter is cancelled whether or
 * not it applies: closing the menu hands focus back to the editor while this
 * keydown still runs, and an uncancelled Enter splits the item at the caret.
 */
export const submitNumberOnEnter = (
  event: { preventDefault: () => void },
  value: number | null,
  onSetValue: (value: number) => void,
) => {
  event.preventDefault();
  if (value !== null && Number.isInteger(value) && value >= 0) onSetValue(value);
};

interface NumberMenuContentProps {
  numbering: ListNumbering;
  onContinue: () => void;
  onRestart: () => void;
  onSetValue: (value: number) => void;
}

const NumberMenuContent = memo<NumberMenuContentProps>(
  ({ numbering, onContinue, onRestart, onSetValue }) => {
    const { t } = useTranslation('editor');
    const [value, setValue] = useState<number | null>(numbering.value);

    return (
      <Flexbox gap={2}>
        <Button
          block
          className={stylex.props(styles.item).className}
          disabled={!numbering.canContinue}
          type="text"
          onClick={onContinue}
        >
          {numbering.isHeading ? t('list.number.continueHeading') : t('list.number.continue')}
        </Button>
        <Flexbox
          horizontal
          align="center"
          gap={8}
          justify="space-between"
          {...stylex.props(styles.valueRow)}
        >
          <Text>{t('list.number.value')}</Text>
          <InputNumber
            autoFocus
            min={0}
            precision={0}
            size="small"
            style={{ width: 72 }}
            value={value}
            onChange={setValue}
            onPressEnter={(event) => submitNumberOnEnter(event, value, onSetValue)}
          />
        </Flexbox>
        <Button
          block
          className={stylex.props(styles.item).className}
          type="text"
          onClick={onRestart}
        >
          {t('list.number.restart')}
        </Button>
      </Flexbox>
    );
  },
);

NumberMenuContent.displayName = 'NumberMenuContent';

/**
 * A menu on an ordered list's number to continue earlier numbering, set the
 * number, or start a new list there. With the pointer: hovering the number
 * highlights it and clicking opens the menu. Without it: `requestListNumberMenu`
 * (the slash menu's "Set number") opens the menu on the caret's item.
 */
const OrderedListNumberMenu = memo<{ editor: IEditor }>(({ editor }) => {
  const { t } = useTranslation('editor');
  const [marker, setMarker] = useState<Marker>();
  const [open, setOpen] = useState(false);
  // A menu opened from the keyboard gives the caret back when it closes.
  const openedFromKeyboard = useRef(false);

  useEffect(
    () =>
      onListNumberMenuRequest(editor, (key) => {
        const li = editor.getLexicalEditor?.()?.getElementByKey(key);
        if (!(li instanceof HTMLLIElement)) return;
        openedFromKeyboard.current = true;
        setMarker({ key, ...getMarker(li) });
        setOpen(true);
      }),
    [editor],
  );

  useEffect(() => {
    if (open) return;

    let frame = 0;
    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // The Lexical editor exists only once <Editor> has mounted.
        const lexical = editor.getLexicalEditor?.();
        const root = lexical?.getRootElement();
        const hit = root ? findMarkerItem(root, event.clientX, event.clientY) : undefined;
        const key = hit && lexical?.read(() => $getNearestNodeFromDOMNode(hit.li)?.getKey());
        setMarker(hit && key ? { key, ...hit.marker } : undefined);
      });
    };
    const onScroll = () => setMarker(undefined);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('scroll', onScroll, true);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [editor, open]);

  const lexical = editor.getLexicalEditor?.();
  if (!lexical || !marker) return null;

  const numbering = lexical.read(() => {
    const node = $getNodeByKey(marker.key);
    return $isListItemNode(node) ? $getListNumbering(node) : undefined;
  });
  if (!numbering) return null;

  const close = () => {
    setOpen(false);
    setMarker(undefined);
    if (openedFromKeyboard.current) {
      openedFromKeyboard.current = false;
      lexical.focus();
    }
  };

  const update = (fn: (item: ListItemNode) => void) => {
    lexical.update(() => {
      const node = $getNodeByKey(marker.key);
      if ($isListItemNode(node)) fn(node);
    });
    close();
  };

  const { height, left, top, width } = marker.rect;

  return createPortal(
    <Popover
      arrow={false}
      open={open}
      placement="bottomLeft"
      trigger="click"
      content={
        <NumberMenuContent
          numbering={numbering}
          onContinue={() => update($continueListNumbering)}
          onRestart={() => update((item) => $setListItemNumber(item, 1))}
          onSetValue={(value) => update((item) => $setListItemNumber(item, value))}
        />
      }
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <span {...sx(styles.anchor, { height, left, top, width })}>
        <Tooltip open={open ? false : undefined} title={t('list.number.set')}>
          <button
            aria-label={t('list.number.set')}
            type="button"
            {...sx(styles.marker, marker.style)}
            // Keep the editor's selection while the menu opens.
            onMouseDown={(event) => event.preventDefault()}
          >
            {marker.label}
          </button>
        </Tooltip>
      </span>
    </Popover>,
    document.body,
  );
});

OrderedListNumberMenu.displayName = 'OrderedListNumberMenu';

export default OrderedListNumberMenu;
