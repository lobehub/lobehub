'use client';

import { createStaticStyles, cssVar } from '@lobehub/ui';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

const styles = createStaticStyles(({ css }) => ({
  handle: css`
    cursor: col-resize;
    user-select: none;

    position: absolute;
    z-index: 1;
    inset-block: 0;
    inset-inline-end: 0;
    transform: translateX(-4px);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 16px;

    &::after {
      content: '';

      width: 1.5px;
      height: calc(100% - 16px);
      border-radius: 1px;

      background-color: ${cssVar.colorBorder};

      transition: all 0.2s;
    }

    &:hover::after {
      width: 3px;
      background-color: ${cssVar.colorPrimary};
    }
  `,
  handleDragging: css`
    &::after {
      width: 3px !important;
      background-color: ${cssVar.colorPrimary} !important;
    }
  `,
}));

interface ColumnResizeHandleProps {
  column: 'name' | 'date' | 'size' | 'uploader';
  currentWidth: number;
  maxWidth: number;
  minWidth: number;
  onResize: (width: number) => void;
}

const ColumnResizeHandle = memo<ColumnResizeHandleProps>(
  ({ column, currentWidth, minWidth, maxWidth, onResize }) => {
    const [isDragging, setIsDragging] = useState(false);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);
    const suppressClickRef = useRef<((event: MouseEvent) => void) | null>(null);

    const removeClickGuard = useCallback(() => {
      if (!suppressClickRef.current) return;

      document.removeEventListener('click', suppressClickRef.current, true);
      suppressClickRef.current = null;
    }, []);

    const handleMouseMove = useCallback(
      (e: MouseEvent) => {
        const delta = e.clientX - startXRef.current;
        const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));

        // Update width in real-time during drag
        onResize(newWidth);
      },
      [minWidth, maxWidth, onResize],
    );

    const handleMouseUp = useCallback(() => {
      setIsDragging(false);
      // Resizing usually releases the pointer outside the 16px handle, so the
      // browser dispatches the follow-up click on a common ancestor (the
      // column header). Keep the capture guard alive for that click, then
      // release it in case no click is dispatched at all.
      setTimeout(removeClickGuard, 0);
    }, [removeClickGuard]);

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setIsDragging(true);
        startXRef.current = e.clientX;
        startWidthRef.current = currentWidth;

        // Catch the click that follows this drag before it reaches the
        // sortable column header, whatever element it is dispatched on.
        removeClickGuard();
        const suppressClick = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          removeClickGuard();
        };
        suppressClickRef.current = suppressClick;
        document.addEventListener('click', suppressClick, true);
      },
      [currentWidth, removeClickGuard],
    );

    useEffect(() => removeClickGuard, [removeClickGuard]);

    // Attach document-level event listeners when dragging
    useEffect(() => {
      if (isDragging) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Disable text selection and lock cursor during drag
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        return () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
        };
      }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    return (
      <div
        className={`${styles.handle} ${isDragging ? styles.handleDragging : ''}`}
        data-column-resize-handle={column}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
      />
    );
  },
);

ColumnResizeHandle.displayName = 'ColumnResizeHandle';

export default ColumnResizeHandle;
