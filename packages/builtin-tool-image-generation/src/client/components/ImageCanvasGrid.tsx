'use client';

import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    gap: 8px;
    width: 100%;
  `,
}));

// A lone image is the hero of the message; several share the same footprint.
const SINGLE_MAX_HEIGHT = 420;
const SINGLE_MAX_WIDTH = 480;
const MULTI_MAX_WIDTH = 560;

interface ImageCanvasGridProps {
  children: ReactNode;
  count: number;
  /**
   * width / height of each canvas
   */
  ratio: number;
}

export const ImageCanvasGrid = memo<ImageCanvasGridProps>(({ children, count, ratio }) => {
  const single = count <= 1;
  const columns = single ? 1 : count === 3 ? 3 : 2;
  // Cap a portrait hero by height so it cannot take over the viewport.
  const maxWidth = single
    ? Math.min(SINGLE_MAX_WIDTH, Math.round(SINGLE_MAX_HEIGHT * ratio))
    : MULTI_MAX_WIDTH;

  return (
    <div
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, maxWidth }}
    >
      {children}
    </div>
  );
});

ImageCanvasGrid.displayName = 'ImageCanvasGrid';

export default ImageCanvasGrid;
