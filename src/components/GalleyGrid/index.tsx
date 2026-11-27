import { Flexbox, useResponsive } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { useDensity } from '@/styles/density';

import Grid from './Grid';
import { MAX_SIZE_DESKTOP, MAX_SIZE_MOBILE } from './style';

const COMPACT_ITEM_STYLE = { borderRadius: 6 };

interface GalleyGridProps<T = any> {
  items: T[];
  renderItem: (props: T) => ReactNode;
}

const GalleyGrid = memo<GalleyGridProps>(({ items, renderItem: Render }) => {
  const { mobile } = useResponsive();
  const { compact } = useDensity();
  const itemStyle = compact ? COMPACT_ITEM_STYLE : undefined;

  const { firstRow, lastRow } = useMemo(() => {
    if (items.length === 4) {
      return {
        firstRow: items.slice(0, 2),
        lastRow: items.slice(2, 4),
      };
    }

    const firstCol = items.length > 4 ? 3 : items.length;

    return {
      firstRow: items.slice(0, firstCol),
      lastRow: items.slice(firstCol, items.length),
    };
  }, [items]);

  const { gap, max } = useMemo(() => {
    let scale = firstRow.length * (firstRow.length / items.length);

    scale = scale < 1 ? 1 : scale;

    return {
      gap: mobile || compact ? 4 : 6,
      max: (mobile ? MAX_SIZE_MOBILE : MAX_SIZE_DESKTOP) * scale,
    };
  }, [mobile, compact, items]);

  return (
    <Flexbox gap={gap}>
      <Grid col={firstRow.length} gap={gap} max={max}>
        {firstRow.map((i, index) => (
          <Render {...i} index={index} key={index} style={itemStyle} />
        ))}
      </Grid>
      {lastRow.length > 0 && (
        <Grid col={firstRow.length} gap={gap} max={max}>
          {lastRow.map((i, index) => (
            <Render {...i} index={index} key={index} style={itemStyle} />
          ))}
        </Grid>
      )}
    </Flexbox>
  );
});

export default GalleyGrid;
