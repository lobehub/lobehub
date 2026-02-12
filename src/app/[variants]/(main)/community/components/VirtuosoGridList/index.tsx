import { type DivProps } from '@lobehub/ui';
import { Flexbox, Grid } from '@lobehub/ui';
import { memo } from 'react';
import { type VirtuosoGridProps } from 'react-virtuoso';
import { VirtuosoGrid } from 'react-virtuoso';

import { useScrollParent } from './useScrollParent';

export const VirtuosoList = memo<VirtuosoGridProps<any, any>>(({ data, ...rest }) => {
  const scrollParent = useScrollParent();
  const initialItemCount = data && data?.length >= 8 ? 8 : data?.length;
  return (
    <VirtuosoGrid
      customScrollParent={scrollParent}
      data={data}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      initialItemCount={initialItemCount}
      overscan={24}
      components={{
        List: (({ ref, ...props }: DivProps & { ref?: React.RefObject<HTMLDivElement | null> }) => (
          <Flexbox gap={16} ref={ref} {...props} />
        )) as any,
      }}
      {...rest}
    />
  );
});

const VirtuosoGridList = memo<VirtuosoGridProps<any, any>>(
  ({ data, initialItemCount, rows = 4, ...rest }) => {
    const scrollParent = useScrollParent();
    const count = data && data?.length >= 8 ? 8 : data?.length;
    const maxInitialItemCount =
      data && data?.length && initialItemCount && initialItemCount > data?.length
        ? data?.length
        : initialItemCount;
    return (
      <VirtuosoGrid
        customScrollParent={scrollParent}
        data={data}
        increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
        initialItemCount={maxInitialItemCount || count}
        overscan={24}
        components={{
          List: (({
            ref,
            ...props
          }: DivProps & { ref?: React.RefObject<HTMLDivElement | null> }) => (
            <Grid gap={16} maxItemWidth={280} ref={ref} rows={rows} {...props} />
          )) as any,
        }}
        {...rest}
      />
    );
  },
);

export default VirtuosoGridList;
