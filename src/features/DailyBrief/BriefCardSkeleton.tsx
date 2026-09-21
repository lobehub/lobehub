import { Block, Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';

/** Loading placeholder for {@link BriefCard}. */
const BriefCardSkeleton = memo(() => {
  return (
    <Block
      gap={12}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
        >
          <Skeleton.Avatar
            shape={'square'}
            size={28}
            style={{ borderRadius: cssVar.borderRadius, flex: 'none' }}
          />
          <Skeleton height={20} width={200} />
          <Skeleton height={14} width={72} />
        </Flexbox>
        <Skeleton.Avatar shape={'circle'} size={'small'} style={{ flex: 'none' }} />
      </Flexbox>

      <Divider dashed style={{ marginBlock: 0 }} />

      <Skeleton.Text fontSize={14} rows={3} style={{ marginBottom: 0 }} />

      <Flexbox horizontal gap={8} style={{ alignSelf: 'flex-end' }}>
        <Skeleton height={32} width={100} />
        <Skeleton height={32} width={80} />
      </Flexbox>
    </Block>
  );
});

BriefCardSkeleton.displayName = 'BriefCardSkeleton';

export { BriefCardSkeleton };
