'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getWorkTypeDescriptor } from '@/features/Work/descriptors';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgElevated};
  `,
  clickable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  cost: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  icon: css`
    flex-shrink: 0;

    width: 26px;
    height: 26px;
    border-radius: 6px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  preview: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 6;

    min-height: 108px;
    padding-block: 12px;
    padding-inline: 12px;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
    word-break: break-word;
  `,
  title: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
}));

interface WorkPreviewCardProps {
  item: WorkSummaryItem;
  /** The gallery owns navigation (no chat portal on the resource page). */
  onOpen: (item: WorkSummaryItem) => void;
}

/**
 * Gallery cell for the resource page's 产物 view: a vertical card with a
 * header row (type icon + title + cost) and a content-preview body, mirroring
 * the library page's file cards. The preview is the Work's write-time
 * description slice — the in-chat `WorkSummaryCard` stays the compact
 * one-line variant.
 */
const WorkPreviewCard = memo<WorkPreviewCardProps>(({ item, onOpen }) => {
  const { t } = useTranslation('chat');
  const cost = formatWorkVersionCost(item.totalCost);

  const descriptor = getWorkTypeDescriptor(item);
  const Icon = descriptor.getIcon(item);
  const title =
    descriptor.getTitle(item)?.trim() ||
    descriptor.getIdentifier(item) ||
    item.resourceId ||
    item.id;
  const description = descriptor.getDescription(item);
  // Same clickability gating as WorkSummaryCard: no open target or an orphaned
  // (deleted-task) Work renders inert.
  const taskDeleted = item.resourceType === 'task' && item.taskDeleted;
  const clickable = !!descriptor.getOpenTarget(item) && !taskDeleted;

  return (
    <Flexbox
      className={cx(styles.card, clickable && styles.clickable)}
      onClick={clickable ? () => onOpen(item) : undefined}
    >
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Flexbox align={'center'} className={styles.icon} justify={'center'}>
          <Icon size={15} />
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
          <Text ellipsis className={styles.title}>
            {title}
          </Text>
          {taskDeleted && (
            <Tag color={'warning'} icon={<Trash2Icon size={12} />} size={'small'}>
              {t('workingPanel.works.taskDeleted')}
            </Tag>
          )}
        </Flexbox>
        {cost && (
          <Text
            code
            className={styles.cost}
            fontSize={12}
            title={t('workingPanel.works.totalCost', { cost })}
          >
            {cost}
          </Text>
        )}
      </Flexbox>
      <div className={styles.preview}>{description}</div>
    </Flexbox>
  );
});

WorkPreviewCard.displayName = 'WorkPreviewCard';

export default WorkPreviewCard;
