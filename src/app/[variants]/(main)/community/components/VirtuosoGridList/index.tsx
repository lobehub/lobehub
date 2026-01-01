import { type DivProps, Flexbox, Grid } from '@lobehub/ui';
import { forwardRef, memo } from 'react';
import { VirtuosoGrid, type VirtuosoGridProps } from 'react-virtuoso';

import { useScrollParent } from './useScrollParent';

export const VirtuosoList = memo<VirtuosoGridProps<any, any>>(({ data, ...rest }) => {
  const scrollParent = useScrollParent();
  const initialItemCount = data && data?.length >= 8 ? 8 : data?.length;
  return (
    <VirtuosoGrid
      components={{
        List: forwardRef<HTMLDivElement, DivProps>((props, ref) => (
          <Flexbox gap={16} ref={ref} {...props} />
        )),
      }}
      customScrollParent={scrollParent}
      data={data}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      initialItemCount={initialItemCount}
      overscan={24}
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
        components={{
          List: forwardRef<HTMLDivElement, DivProps>((props, ref) => (
            <Grid gap={16} maxItemWidth={280} ref={ref} rows={rows} {...props} />
          )),
        }}
        customScrollParent={scrollParent}
        data={data}
        increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
        initialItemCount={maxInitialItemCount || count}
        overscan={24}
        {...rest}
      />
    );
  },
);

export default VirtuosoGridList;
