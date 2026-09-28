'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

// Mirrors the grouped topic list frame (12px group caption + icon-led 36px
// rows) so the deferred-mount frame reads as the layout it resolves into,
// unlike the avatar-style generic SkeletonList.
const GROUPS = [
  { header: 44, rows: ['82%', '58%', '70%'] },
  { header: 60, rows: ['64%', '76%', '48%', '68%'] },
];

const RowSkeleton = memo<{ width: string }>(({ width }) => (
  <Flexbox horizontal align={'center'} gap={8} height={36} paddingInline={4}>
    <Skeleton
      style={{
        borderRadius: cssVar.borderRadiusSM,
        height: 16,
        maxHeight: 16,
        maxWidth: 16,
        minWidth: 16,
      }}
    />
    <Flexbox flex={1}>
      <Skeleton
        style={{
          borderRadius: cssVar.borderRadius,
          height: 14,
          margin: 0,
          maxHeight: 14,
          opacity: 0.5,
          padding: 0,
          width,
        }}
      />
    </Flexbox>
  </Flexbox>
));

RowSkeleton.displayName = 'TopicRowSkeleton';

const TopicListSkeleton = memo(() => (
  <Flexbox gap={2}>
    {GROUPS.map((group, i) => (
      <Flexbox gap={1} key={i} paddingBlock={4} paddingInline={'8px 4px'}>
        <Flexbox horizontal align={'center'} height={24}>
          <Skeleton
            style={{
              borderRadius: cssVar.borderRadiusSM,
              height: 12,
              maxHeight: 12,
              maxWidth: group.header,
              minWidth: group.header,
              opacity: 0.6,
            }}
          />
        </Flexbox>
        {group.rows.map((width) => (
          <RowSkeleton key={width} width={width} />
        ))}
      </Flexbox>
    ))}
  </Flexbox>
));

TopicListSkeleton.displayName = 'TopicListSkeleton';

export default TopicListSkeleton;
