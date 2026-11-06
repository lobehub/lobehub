'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

const styles = stylex.create({
  handle: {
    'cursor': 'col-resize',
    'userSelect': 'none',
    'position': 'absolute',
    'zIndex': 1,
    'insetBlockStart': 0,
    'insetBlockEnd': 0,
    'insetInlineEnd': 0,
    'transform': 'translateX(-4px)',
    'display': 'flex',
    'alignItems': 'center',
    'justifyContent': 'center',
    'width': '16px',
    '::after': {
      content: "''",
      width: { 'default': '1.5px', ':hover': '3px' },
      height: 'calc(100% - 16px)',
      borderRadius: '1px',
      backgroundColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorPrimary },
      transition: 'all 0.2s',
    },
  },
  dragging: {
    '::after': {
      width: '3px',
      backgroundColor: cssVar.colorPrimary,
    },
  },
});

interface ColumnResizeHandleProps {
  column: 'name' | 'date' | 'size' | 'uploader';
  currentWidth: number;
  maxWidth: number;
  minWidth: number;
  onResize: (width: number) => void;
}

const ColumnResizeHandle = memo<ColumnResizeHandleProps>(
  ({ currentWidth, minWidth, maxWidth, onResize }) => {
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
        {...stylex.props(styles.handle, isDragging && styles.dragging)}
        onMouseDown={handleMouseDown}
      />
    );
  },
);

ColumnResizeHandle.displayName = 'ColumnResizeHandle';

export default ColumnResizeHandle;
