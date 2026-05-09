import { Block, Flexbox, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';

/** Loading placeholder for {@link BriefCard} and task-template recommend cards (shared layout). */
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
            active
            shape={'square'}
            size={28}
            style={{ borderRadius: cssVar.borderRadius, flex: 'none' }}
          />
          <Skeleton.Button active style={{ height: 20, width: 200 }} />
          <Skeleton.Button active style={{ height: 14, width: 72 }} />
        </Flexbox>
        <Skeleton.Avatar active shape={'circle'} size={'small'} style={{ flex: 'none' }} />
      </Flexbox>

      <Divider dashed style={{ marginBlock: 0 }} />

      <Skeleton.Paragraph active fontSize={14} rows={3} style={{ marginBottom: 0 }} />

      <Flexbox horizontal gap={8} style={{ alignSelf: 'flex-end' }}>
        <Skeleton.Button active style={{ height: 32, width: 100 }} />
        <Skeleton.Button active style={{ height: 32, width: 80 }} />
      </Flexbox>
    </Block>
  );
});

BriefCardSkeleton.displayName = 'BriefCardSkeleton';

export { BriefCardSkeleton };
