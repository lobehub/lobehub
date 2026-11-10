import {
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- grid cells are caller-provided children
  createStaticStyles,
  cx,
  Flexbox,
} from '@lobehub/ui';
import { type CSSProperties, type ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { MAX_SIZE_DESKTOP, MIN_IMAGE_SIZE } from './style';

const fallback = createStaticStyles(({ css }) => ({
  container: css`
    display: grid;
    grid-gap: var(--galley-grid-gap, 6px);
    grid-template-columns: repeat(var(--galley-grid-col, 3), 1fr);

    width: 100%;
    max-width: var(--galley-grid-max, 200px);

    > div {
      width: 100%;
      min-width: var(--galley-grid-min, 64px);
      min-height: var(--galley-grid-min, 64px);
      max-height: calc(
        (
            var(--galley-grid-max, 200px) - var(--galley-grid-gap, 6px) *
              (var(--galley-grid-col, 3) - 1)
          ) /
          var(--galley-grid-col, 3)
      );
    }
  `,
}));

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
        className={cx(fallback.container, className)}
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
