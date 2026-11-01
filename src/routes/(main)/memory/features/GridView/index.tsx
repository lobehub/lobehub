import { type DivProps, Grid } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';

import LoadMoreFooter from '../LoadMoreFooter';
import { autoLoadMoreProps, resolveLoadMoreFooter } from '../loadMoreFooterState';
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
   * Failure of the last "load more" request; rendered with a retry below the rows
   */
  loadMoreError?: unknown;
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
  loadMoreError,
  onLoadMore,
  renderItem,
}: GridViewProps<T>) {
  const scrollParent = useScrollParent();
  const footer = resolveLoadMoreFooter({ isLoading, loadMoreError });

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <VirtuosoGrid
      customScrollParent={scrollParent}
      {...autoLoadMoreProps({ hasMore, items, loadMoreError, onLoadMore })}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      overscan={48}
      style={{ minHeight: '100%' }}
      components={{
        Footer: footer
          ? () => (
              <LoadMoreFooter
                loadMoreError={loadMoreError}
                rows={defaultColumnCount}
                state={footer}
                viewMode={'grid'}
                onRetry={onLoadMore}
              />
            )
          : undefined,
        // eslint-disable-next-line @eslint-react/no-nested-component-definitions
        List: (({ ref, ...props }: DivProps & { ref?: React.RefObject<HTMLDivElement | null> }) => (
          <Grid
            gap={8}
            maxItemWidth={maxItemWidth}
            ref={ref}
            rows={defaultColumnCount}
            {...props}
          />
        )) as any,
      }}
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
    />
  );
}

export const GridView = memo(GridViewInner) as typeof GridViewInner;
