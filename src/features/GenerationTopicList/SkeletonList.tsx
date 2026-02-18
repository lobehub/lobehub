'use client';

import { ActionIcon, Flexbox, Skeleton } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo } from 'react';

const borderRadius = 6;

const SkeletonList = memo(() => {
  return (
    <Flexbox align="center" gap={6} width={'100%'}>
      <ActionIcon
        icon={Plus}
        size={{
          blockSize: 48,
          size: 20,
        }}
        variant={'filled'}
      />

      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index}>
          <Skeleton.Avatar
            active
            size={48}
            style={{
              borderRadius,
            }}
          />
        </div>
      ))}
    </Flexbox>
  );
});

SkeletonList.displayName = 'SkeletonList';

export default SkeletonList;
