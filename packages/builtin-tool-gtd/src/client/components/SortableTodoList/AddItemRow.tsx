'use client';

import { ActionIcon, Checkbox, Flexbox, Input } from '@lobehub/ui';
import type { InputRef } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ADD_ITEM_ID, useTodoListStore } from './store';

const styles = createStaticStyles(({ css }) => ({
  addRow: css`
    padding-block: 10px;
    padding-inline: 12px;
  `,
  dragHandlePlaceholder: css`
    width: 8px;
  `,
}));

interface AddItemRowProps {
  className?: string;
  placeholder?: string;
  showDragHandle?: boolean;
}

const AddItemRow = memo<AddItemRowProps>(({ placeholder, showDragHandle = true, className }) => {
  const { t } = useTranslation('tool');
  const inputRef = useRef<InputRef>(null);
  const defaultPlaceholder = placeholder || t('lobe-gtd.addTodo.placeholder');

  const newItemText = useTodoListStore((s) => s.newItemText);
  const focusedId = useTodoListStore((s) => s.focusedId);
  const cursorPosition = useTodoListStore((s) => s.cursorPosition);
  const setNewItemText = useTodoListStore((s) => s.setNewItemText);
  const addItem = useTodoListStore((s) => s.addItem);
  const focusPrevItem = useTodoListStore((s) => s.focusPrevItem);
  const setFocusedId = useTodoListStore((s) => s.setFocusedId);

  // Focus input when focusedId changes to this input and restore cursor position
  const prevFocusedIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Only restore cursor when focus changes TO this input (not on every cursorPosition change)
    if (focusedId === ADD_ITEM_ID && prevFocusedIdRef.current !== ADD_ITEM_ID) {
      const input = inputRef.current?.input;
      if (input) {
        input.focus();
        // Clamp cursor position to text length
        const pos = Math.min(cursorPosition, newItemText.length);
        input.setSelectionRange(pos, pos);
      }
    }
    prevFocusedIdRef.current = focusedId;
  }, [focusedId, cursorPosition, newItemText.length]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setNewItemText(e.target.value);
    },
    [setNewItemText],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const cursorPos = input.selectionStart ?? 0;

      if (e.key === 'Enter') {
        e.preventDefault();
        addItem();
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        focusPrevItem(ADD_ITEM_ID, cursorPos);
      } else if (e.key === 'Tab' && !e.shiftKey) {
        // Prevent default tab behavior to keep focus in the todo list
        e.preventDefault();
      }
    },
    [addItem, focusPrevItem],
  );

  const handleFocus = useCallback(() => {
    setFocusedId(ADD_ITEM_ID);
  }, [setFocusedId]);

  return (
    <Flexbox horizontal align="center" className={cx(styles.addRow, className)} gap={4}>
      {showDragHandle && <div className={styles.dragHandlePlaceholder} />}
      <Checkbox checked={false} shape={'circle'} style={{ borderWidth: 1.5, cursor: 'default' }} />
      <Input
        placeholder={defaultPlaceholder}
        ref={inputRef}
        size="small"
        style={{ flex: 1 }}
        value={newItemText}
        variant="borderless"
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      />
      <ActionIcon icon={Plus} size="small" tabIndex={-1} onClick={addItem} />
    </Flexbox>
  );
});

AddItemRow.displayName = 'AddItemRow';

export default AddItemRow;
