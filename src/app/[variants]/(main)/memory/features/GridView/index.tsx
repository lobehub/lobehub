import { type DivProps, Grid } from '@lobehub/ui';
import { type ReactNode, forwardRef, memo } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';

import Loading from '@/app/[variants]/(main)/memory/features/Loading';

import { useScrollParent } from '../TimeLineView/useScrollParent';

interface GridViewProps<T> {
  /**
   * Default column count (rows in Grid component)
   * Will be responsive based on window width
   */
  defaultColumnCount?: number;
  /**
   * Whether there are more items to load
   */
  hasMore?: boolean;
  /**
   * Whether data is currently loading
   */
  isLoading?: boolean;
  items: T[];
  /**
   * Max item width in pixels
   */
  maxItemWidth?: number;
  /**
   * Callback when end is reached
   */
  onLoadMore?: () => void;
  renderItem: (item: T, actions: ItemActions<T>) => ReactNode;
}

interface ItemActions<T> {
  onClick?: (item: T) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
}

function GridViewInner<T extends { id: string }>({
  items,
  defaultColumnCount = 3,
  maxItemWidth = 240,
  hasMore,
  isLoading,
  onLoadMore,
  renderItem,
}: GridViewProps<T>) {
  const scrollParent = useScrollParent();

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <VirtuosoGrid
      components={{
        Footer: isLoading
          ? () => <Loading rows={defaultColumnCount} viewMode={'grid'} />
          : undefined,
        List: forwardRef<HTMLDivElement, DivProps>((props, ref) => (
          <Grid
            gap={8}
            maxItemWidth={maxItemWidth}
            ref={ref}
            rows={defaultColumnCount}
            {...props}
          />
        )),
      }}
      customScrollParent={scrollParent}
      data={items}
      endReached={hasMore && onLoadMore ? onLoadMore : undefined}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemContent={(index, item) => {
        if (!item || !item.id) {
          return null;
        }

        const actions: ItemActions<T> = {
          onClick: undefined,
          onDelete: undefined,
          onEdit: undefined,
        };

        return renderItem(item, actions);
      }}
      overscan={48}
      style={{ minHeight: '100%' }}
    />
  );
}

export const GridView = memo(GridViewInner) as typeof GridViewInner;
