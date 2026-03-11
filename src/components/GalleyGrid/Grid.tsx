import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { type CSSProperties, type ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { MAX_SIZE_DESKTOP, MIN_IMAGE_SIZE, styles } from './style';

interface GridProps {
  children: ReactNode;
  className?: string;
  col?: number;
  gap?: number;
  max?: number;
  min?: number;
  style?: CSSProperties;
}

const Grid = memo<GridProps>(
  ({
    gap = 4,
    col = 3,
    max = MAX_SIZE_DESKTOP,
    min = MIN_IMAGE_SIZE,
    children,
    className,
    style,
  }) => {
    const cssVariables = useMemo<Record<string, string>>(
      () => ({
        '--galley-grid-col': `${col}`,
        '--galley-grid-gap': `${gap}px`,
        '--galley-grid-max': `${max}px`,
        '--galley-grid-min': `${min}px`,
      }),
      [col, gap, max, min],
    );

    return (
      <Flexbox
        horizontal
        className={cx(styles.container, className)}
        gap={gap}
        style={{
          ...cssVariables,
          ...style,
        }}
      >
        {children}
      </Flexbox>
    );
  },
);

export default Grid;
