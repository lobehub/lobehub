import { Block, Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';

import { styles as briefStyles } from '@/features/DailyBrief/style';
import { RECOMMENDATION_ICON_SIZE } from '@/features/Recommendations/iconSize';

import { styles } from './style';

interface TaskTemplateCardSkeletonProps {
  compact?: boolean;
  descriptionRows?: number;
}

export const TaskTemplateCardSkeleton = memo<TaskTemplateCardSkeletonProps>(
  ({ compact, descriptionRows = 1 }) => {
    if (compact)
      return (
        <Flexbox
          horizontal
          align={'center'}
          data-testid={'task-template-card-skeleton'}
          gap={10}
          paddingBlock={6}
        >
          <Skeleton.Avatar
            shape={'square'}
            size={RECOMMENDATION_ICON_SIZE.compact}
            style={{ borderRadius: cssVar.borderRadius, flex: 'none' }}
          />
          <Skeleton height={16} width={'70%'} />
        </Flexbox>
      );

    return (
      <Block
        className={cx(briefStyles.card, styles.card)}
        data-testid={'task-template-card-skeleton'}
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
              size={RECOMMENDATION_ICON_SIZE.regular}
              style={{ borderRadius: cssVar.borderRadius, flex: 'none' }}
            />
            <Flexbox
              horizontal
              align={'center'}
              flex={1}
              gap={6}
              style={{ minWidth: 0, overflow: 'hidden' }}
            >
              <Skeleton height={20} width={180} />
              <Skeleton.Avatar shape={'circle'} size={12} style={{ flex: 'none' }} />
            </Flexbox>
          </Flexbox>

          <Skeleton.Avatar shape={'circle'} size={24} style={{ flex: 'none' }} />
        </Flexbox>

        <Divider dashed style={{ marginBlock: 0 }} />

        <Skeleton.Text fontSize={14} rows={descriptionRows} style={{ marginBottom: 0 }} />

        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Skeleton height={22} width={72} />
          <Skeleton height={32} width={96} />
        </Flexbox>
      </Block>
    );
  },
);

TaskTemplateCardSkeleton.displayName = 'TaskTemplateCardSkeleton';
