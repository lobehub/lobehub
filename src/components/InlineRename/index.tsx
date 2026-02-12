'use client';

import { type InputProps } from '@lobehub/ui';
import { Input, Popover, stopPropagation } from '@lobehub/ui';
import { type InputRef, type PopoverProps } from 'antd';
import { type KeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

function FocusableInput(props: InputProps) {
  const ref = useRef<InputRef>(null);
  useEffect(() => {
    queueMicrotask(() => {
      ref.current?.input?.focus();
    });
  }, []);
  return <Input {...props} ref={ref} />;
}

export interface InlineRenameProps {
  /**
   * Callback when editing is cancelled (Escape key)
   */
  onCancel?: () => void;
  /**
   * Callback when open state changes
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Callback to save the new title
   */
  onSave: (newTitle: string) => void | Promise<void>;
  /**
   * Whether the popover is open (editing mode)
   */
  open: boolean;
  /**
   * Popover placement
   */
  placement?: PopoverProps['placement'];
  /**
   * Current title
   */
  title: string;
  /**
   * Popover width
   */
  width?: number;
}

const InlineRename = memo<InlineRenameProps>(
  ({ open, title, onOpenChange, onSave, onCancel, placement = 'bottomLeft', width = 320 }) => {
    const [newTitle, setNewTitle] = useState(title);
    const savedRef = useRef(false);

    // Reset state when opening
    useEffect(() => {
      if (open) {
        setNewTitle(title);
        savedRef.current = false;
      }
    }, [open, title]);

    const handleSave = useCallback(async () => {
      if (savedRef.current) return;

      if (newTitle && title !== newTitle) {
        savedRef.current = true;
        await onSave(newTitle);
      }
    }, [newTitle, title, onSave]);

    const handleClose = useCallback(() => {
      onOpenChange(false);
    }, [onOpenChange]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel?.();
          handleClose();
        }
      },
      [onCancel, handleClose],
    );

    return (
      <Popover
        open={open}
        placement={placement}
        trigger="click"
        content={
          <FocusableInput
            defaultValue={title}
            onBlur={handleSave}
            onChange={(e) => setNewTitle(e.target.value)}
            onClick={stopPropagation}
            onKeyDown={handleKeyDown}
            onPressEnter={() => {
              handleSave();
              handleClose();
            }}
          />
        }
        styles={{
          content: {
            padding: 4,
            width,
          },
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) handleSave();
          onOpenChange(nextOpen);
        }}
      >
        <div />
      </Popover>
    );
  },
);

export default InlineRename;
