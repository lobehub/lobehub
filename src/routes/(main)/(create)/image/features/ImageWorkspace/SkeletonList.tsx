'use client';

import { Block, Center, Flexbox, Grid } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import PromptInput from '@/routes/(main)/(create)/image/features/PromptInput';

interface SkeletonListProps {
  /** When false, rendered by the page-level input box; the input box is not rendered here (avoids double input flickering when switching topics) */
  embedInput?: boolean;
}

const SkeletonList = memo<SkeletonListProps>(({ embedInput = true }) => {
  return (
    <Flexbox style={{ minHeight: 'calc(100vh - 44px)' }}>
      <Block variant={'borderless'}>
        <Flexbox gap={12}>
          {/* Prompt text skeleton */}
          <Skeleton height={20} width={'95%'} />

          {/* Metadata skeleton */}
          <Flexbox horizontal gap={12} style={{ width: '100%' }}>
            <Skeleton height={16} width={120} />
            <Skeleton height={16} width={80} />
            <Skeleton height={16} width={60} />
            <Skeleton height={16} width={70} />
          </Flexbox>

          {/* Image grid skeleton - 2x2 layout */}
          <Grid maxItemWidth={200} rows={4} width={'100%'}>
            {Array.from({ length: 4 }).map((_, imageIndex) => (
              <Skeleton height={200} key={imageIndex} width={'100%'} />
            ))}
          </Grid>
        </Flexbox>
      </Block>
      <div style={{ flex: 1 }} />
      {embedInput && (
        <Center
          style={{
            bottom: 24,
            position: 'sticky',
            width: '100%',
          }}
        >
          <PromptInput disableAnimation={true} showTitle={false} />
        </Center>
      )}
    </Flexbox>
  );
});

SkeletonList.displayName = 'SkeletonList';

export default SkeletonList;
