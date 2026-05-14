import { Block, Flexbox, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';

import { styles as briefStyles } from '@/features/DailyBrief/style';

import { styles } from './style';

interface TaskTemplateCardSkeletonProps {
  descriptionRows?: number;
}

export const TaskTemplateCardSkeleton = memo<TaskTemplateCardSkeletonProps>(
  ({ descriptionRows = 1 }) => {
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
              active
              shape={'square'}
              size={28}
              style={{ borderRadius: cssVar.borderRadius, flex: 'none' }}
            />
            <Flexbox
              horizontal
              align={'center'}
              flex={1}
              gap={6}
              style={{ minWidth: 0, overflow: 'hidden' }}
            >
              <Skeleton.Button active style={{ height: 20, width: 180 }} />
              <Skeleton.Avatar active shape={'circle'} size={12} style={{ flex: 'none' }} />
            </Flexbox>
          </Flexbox>

          <Skeleton.Avatar active shape={'circle'} size={'small'} style={{ flex: 'none' }} />
        </Flexbox>

        <Divider dashed style={{ marginBlock: 0 }} />

        <Skeleton.Paragraph
          active
          fontSize={14}
          rows={descriptionRows}
          style={{ marginBottom: 0 }}
        />

        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Skeleton.Button active style={{ height: 22, width: 72 }} />
          <Skeleton.Button active style={{ height: 32, width: 96 }} />
        </Flexbox>
      </Block>
    );
  },
);

TaskTemplateCardSkeleton.displayName = 'TaskTemplateCardSkeleton';
