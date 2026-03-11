'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

const SuggestQuestionsSkeleton = memo(() => {
  return (
    <Flexbox gap={12} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton.Button
          active
          key={i}
          size={'large'}
          style={{
            borderRadius: cssVar.borderRadiusLG,
            height: 72,
            maxHeight: 72,
            opacity: 0.5,
            width: '100%',
          }}
        />
      ))}
    </Flexbox>
  );
});

export default SuggestQuestionsSkeleton;
