import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

const DetailsLoading = memo(() => {
  return (
    <Flexbox gap={24}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={16} width={'100%'}>
          <Skeleton.Avatar shape={'square'} size={64} />
          <Skeleton height={36} width={200} />
        </Flexbox>
        <Skeleton height={28} width={200} />
      </Flexbox>
      <Flexbox
        horizontal
        gap={12}
        height={54}
        style={{
          borderBottom: `1px solid ${cssVar.colorBorder}`,
        }}
      >
        <Skeleton height={36} />
        <Skeleton height={36} />
      </Flexbox>
      <Flexbox
        flex={1}
        gap={16}
        width={'100%'}
        style={{
          overflow: 'hidden',
        }}
      >
        <Skeleton.Text rows={3} />
        <Skeleton.Text rows={8} />
        <Skeleton.Text rows={8} />
      </Flexbox>
    </Flexbox>
  );
});

export default DetailsLoading;
