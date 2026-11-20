'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useImageStage } from '../context';
import { type AnnotationShape, drawShapes } from './Annotate/shapes';
import CommentMarkers from './Comment/CommentMarkers';
import type { MarkupComment } from './markup';
import { toolStyles } from './styles';

interface MarkupPreviewProps {
  comments?: MarkupComment[];
  shapes?: AnnotationShape[];
}

/**
 * Read-only view of the pending marks over the image, so drawings stay visible
 * while commenting (and comments while drawing). It ignores the pointer.
 */
const MarkupPreview = ({ comments = [], shapes = [] }: MarkupPreviewProps) => {
  const { overlayElement, rotation } = useImageStage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    if (!overlayElement || shapes.length === 0) return;
    const sync = () => {
      const ratio = window.devicePixelRatio || 1;
      setSize({
        height: Math.max(1, Math.round(overlayElement.clientHeight * ratio)),
        width: Math.max(1, Math.round(overlayElement.clientWidth * ratio)),
      });
    };
    sync();
    if (!('ResizeObserver' in window)) return;
    const observer = new ResizeObserver(sync);
    observer.observe(overlayElement);
    return () => observer.disconnect();
  }, [overlayElement, shapes.length]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size.width, size.height);
    drawShapes(ctx, shapes, size.width, size.height);
  }, [shapes, size]);

  if (!overlayElement || (comments.length === 0 && shapes.length === 0)) return null;

  return createPortal(
    <div
      className={toolStyles.overlayFill}
      data-testid={'image-markup-preview'}
      style={{ pointerEvents: 'none' }}
    >
      {shapes.length > 0 && (
        <canvas
          aria-hidden
          height={size.height}
          ref={canvasRef}
          style={{ height: '100%', inset: 0, position: 'absolute', width: '100%' }}
          width={size.width}
        />
      )}
      <CommentMarkers comments={comments} rotation={rotation} />
    </div>,
    overlayElement,
  );
};

export default MarkupPreview;
