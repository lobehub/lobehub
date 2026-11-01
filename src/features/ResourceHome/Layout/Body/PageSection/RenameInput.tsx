'use client';

import { Input, preventDefaultAndStopPropagation, stopPropagation } from '@lobehub/ui';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pageActions } from '@/store/page';

interface RenameInputProps {
  id: string;
  /** Closes the editor; the store clears `renamingPageId` on commit itself. */
  onDone: () => void;
  title: string;
}

/**
 * Inline rename field for a page row, the same shape knowledge-base rows use.
 * It replaces the row title instead of opening a popover: the row is only a few
 * dozen pixels tall inside a scrollable sidebar, and a popover anchored to a
 * zero-size node landed nowhere the user could see.
 */
const RenameInput = memo<RenameInputProps>(({ id, title, onDone }) => {
  const { t } = useTranslation('file');

  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    setValue(title);
    submittingRef.current = false;

    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [title]);

  const handleUpdate = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    const next = value.trim();
    if (next && next !== title) {
      // `renamePage` clears `renamingPageId` in its own `finally`.
      await pageActions.renamePage(id, next);
    }

    onDone();
  }, [id, onDone, title, value]);

  /**
   * Dismissal is driven by a pointer landing outside the field, not by focus.
   * Opening the field from the row menu hands focus back to the menu trigger a
   * few hundred milliseconds later — and React can re-render the row while the
   * menu closes — so a blur-commit closed the field before it could be typed
   * into. A document-level `pointerdown` has neither dependency: the field stays
   * open until the user actually clicks somewhere else.
   */
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container || !(event.target instanceof Node)) return;
      // A pointer inside the field belongs to the field, not to the dismissal:
      // clicking the field to place the caret must not end the edit.
      if (container.contains(event.target)) return;

      void handleUpdate();
    };

    // Capture phase: a row click navigates, and its handler may unmount us first.
    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [handleUpdate]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDone();
      }
    },
    [onDone],
  );

  return (
    <span ref={containerRef} style={{ display: 'block', width: '100%' }}>
      <Input
        autoFocus
        data-testid={'page-rename-input'}
        maxLength={64}
        placeholder={t('pageEditor.titlePlaceholder')}
        ref={inputRef}
        size={'small'}
        style={{ width: '100%' }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        // The field can sit inside the row's link, so the click that places the
        // caret has to cancel the anchor's default action too. Stopping the
        // React event alone still lets the browser follow `href`, and the
        // resulting navigation unmounts the field mid-edit.
        onClick={preventDefaultAndStopPropagation}
        onKeyDown={handleKeyDown}
        // No `preventDefault` here: the anchor's navigation is the click's
        // default action, while a mousedown default is the focus move that
        // puts the caret in the field.
        onMouseDown={stopPropagation}
        onPressEnter={() => void handleUpdate()}
      />
    </span>
  );
});

RenameInput.displayName = 'PageRenameInput';

export default RenameInput;
