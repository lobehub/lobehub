'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import WideScreenContainer from '../../WideScreenContainer';

const SkeletonList = memo(() => {
  return (
    <WideScreenContainer flex={1} gap={36} height={'100%'} padding={12} style={{ marginTop: 24 }}>
      {/* User Message */}
      <Flexbox
        gap={8}
        width={'100%'}
        style={{
          paddingLeft: '25%',
        }}
      >
        <Skeleton.Paragraph
          active
          rows={3}
          style={{
            alignItems: 'flex-end',
          }}
        />
      </Flexbox>

      {/* Assistant Message */}
      <Flexbox gap={8} width={'100%'}>
        <Skeleton
          active
          paragraph={false}
          avatar={{
            shape: 'square',
            size: 28,
          }}
        />
        <Skeleton.Paragraph />
        <Skeleton.Tags count={2} />
      </Flexbox>

      {/* Assistant Message */}
      <Flexbox gap={8} width={'100%'}>
        <Skeleton
          active
          paragraph={false}
          avatar={{
            shape: 'square',
            size: 28,
          }}
        />
        <Skeleton.Paragraph />
        <Skeleton.Tags count={2} />
      </Flexbox>
    </WideScreenContainer>
  );
});

export default SkeletonList;
