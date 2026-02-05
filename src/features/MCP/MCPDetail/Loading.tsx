import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

const DetailsLoading = memo(() => {
  return (
    <Flexbox gap={24}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={16} width={'100%'}>
          <Skeleton.Avatar active shape={'square'} size={64} />
          <Skeleton.Button active style={{ height: 36, width: 200 }} />
        </Flexbox>
        <Skeleton.Button active size={'small'} style={{ width: 200 }} />
      </Flexbox>
      <Flexbox
        horizontal
        gap={12}
        height={54}
        style={{
          borderBottom: `1px solid ${cssVar.colorBorder}`,
        }}
      >
        <Skeleton.Button />
        <Skeleton.Button />
      </Flexbox>
      <Flexbox
        flex={1}
        gap={16}
        width={'100%'}
        style={{
          overflow: 'hidden',
        }}
      >
        <Skeleton paragraph={{ rows: 3 }} title={false} />
        <Skeleton paragraph={{ rows: 8 }} title={false} />
        <Skeleton paragraph={{ rows: 8 }} title={false} />
      </Flexbox>
    </Flexbox>
  );
});

export default DetailsLoading;
