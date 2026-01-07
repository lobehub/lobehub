'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

const styles = createStaticStyles(({ css }) => ({
  handle: css`
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: 16px;
    transform: translateX(-4px);
    cursor: col-resize;
    user-select: none;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;

    &::after {
      content: '';
      width: 2px;
      height: calc(100% - 16px);
      background-color: ${cssVar.colorBorder};
      transition: all 0.2s;
      border-radius: 1px;
    }

    &:hover::after {
      background-color: ${cssVar.colorPrimary};
      width: 3px;
    }
  `,
  handleDragging: css`
    &::after {
      background-color: ${cssVar.colorPrimary} !important;
      width: 3px !important;
    }
  `,
}));

interface ColumnResizeHandleProps {
  column: 'name' | 'date' | 'size';
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
    }, []);

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setIsDragging(true);
        startXRef.current = e.clientX;
        startWidthRef.current = currentWidth;
      },
      [currentWidth],
    );

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
        onMouseDown={handleMouseDown}
      />
    );
  },
);

ColumnResizeHandle.displayName = 'ColumnResizeHandle';

export default ColumnResizeHandle;
