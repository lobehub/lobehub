'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageSquarePlusIcon } from 'lucide-react';
import type { PointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
  getFirstLineRect,
  getRangeTextRects,
  getSelectionToolbarPosition,
  type SelectionToolbarPosition,
} from '@/utils/selectionToolbar';

import { type PDFTextSelection, readPDFTextSelection } from './textSelection';

const styles = stylex.create({
  toolbar: {
    position: 'fixed',
    zIndex: 10000,
    transform: 'translate(-50%, -100%)',
    padding: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '999px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
});

interface ActiveSelection {
  position: SelectionToolbarPosition;
  selection: PDFTextSelection;
}

interface TextSelectionActionProps {
  onAdd: (selection: PDFTextSelection) => void;
  /** The scroll container holding the rendered pages. */
  root: HTMLElement | null;
}

/**
 * A floating "Add to chat" action over text selected on the PDF text layer.
 * Picking it hands the text and its pages to `onAdd` and clears the selection.
 */
const TextSelectionAction = ({ onAdd, root }: TextSelectionActionProps) => {
  const { t } = useTranslation('file');
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<ActiveSelection | null>(null);

  const hide = useCallback(() => setActive(null), []);

  // Read the selection after the browser settles it: pointerup and keyup fire
  // before a click-to-deselect collapses the range.
  useEffect(() => {
    if (!root) return;

    let timer: number | undefined;
    const update = () => {
      const nativeSelection = window.getSelection();
      const selection = readPDFTextSelection(nativeSelection, root);
      // Anchor on the selected text: a cross-page range also covers whole
      // overlay layers whose boxes start at the top of the page.
      const rect =
        selection &&
        nativeSelection &&
        getFirstLineRect(getRangeTextRects(nativeSelection.getRangeAt(0)));
      if (!selection || !rect) {
        setActive(null);
        return;
      }

      setActive({ position: getSelectionToolbarPosition(rect, window.innerWidth), selection });
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 0);
    };

    root.addEventListener('pointerup', schedule);
    root.addEventListener('keyup', schedule);

    return () => {
      window.clearTimeout(timer);
      root.removeEventListener('pointerup', schedule);
      root.removeEventListener('keyup', schedule);
    };
  }, [root]);

  useEffect(() => {
    if (!active) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolbarRef.current?.contains(target) || root?.contains(target)) return;

      hide();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      hide();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', hide);
    // The pages scroll under a fixed toolbar, so any scroll detaches it.
    window.addEventListener('scroll', hide, true);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [active, hide, root]);

  const handleAdd = useCallback(() => {
    if (!active) return;

    onAdd(active.selection);
    window.getSelection()?.removeAllRanges();
    hide();
  }, [active, hide, onAdd]);

  // Keep the text selected while the button is pressed.
  const handleToolbarPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  if (!active) return null;

  return createPortal(
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.toolbar).className}
      ref={toolbarRef}
      style={{ left: active.position.left, top: active.position.top }}
      onPointerDown={handleToolbarPointerDown}
    >
      <Button
        icon={<MessageSquarePlusIcon size={14} />}
        size={'small'}
        type={'text'}
        onClick={handleAdd}
      >
        {t('preview.pdf.addSelectionToChat')}
      </Button>
    </Flexbox>,
    document.body,
  );
};

export default TextSelectionAction;
