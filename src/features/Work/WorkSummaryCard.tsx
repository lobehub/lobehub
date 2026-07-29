'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

import { getWorkTypeDescriptor, isSafeExternalUrl } from './descriptors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;

    width: 100%;
    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

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
  description: css`
    min-width: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  icon: css`
    flex-shrink: 0;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  inline: css`
    overflow: hidden;

    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: 6px;

    transition: background-color 0.12s ease;
  `,
  inlineClickable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  inlineCost: css`
    flex-shrink: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  inlineDescription: css`
    min-width: 0;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  inlineIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  inlineTitle: css`
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
  `,
  title: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
}));

interface WorkSummaryCardProps {
  className?: string;
  item: WorkSummaryItem;
  /**
   * Override the click target. The default opens the chat portal (task detail /
   * document), which only renders inside the conversation UI; surfaces without
   * that portal (e.g. the resource page's 产物 gallery) pass their own
   * navigation here. Only ever receives a clickable item — the card still gates
   * clickability on external-url presence and task-deleted state.
   */
  onOpen?: (item: WorkSummaryItem) => void;
  /**
   * `card` (default) renders the elevated 36×36 icon-box layout used across the
   * chat portal and the works gallery. `inline` renders a flat row (17px icon,
   * 6px hover fill) for the WorkingSidebar Overview, so a shared card doesn't
   * dictate the flat sidebar's visual vocabulary.
   */
  variant?: 'card' | 'inline';
}

const WorkSummaryCard = memo<WorkSummaryCardProps>(
  ({ className, item, onOpen, variant = 'card' }) => {
    const { t } = useTranslation('chat');
    const openDocument = useChatStore((s) => s.openDocument);
    const openTaskDetail = useChatStore((s) => s.openTaskDetail);
    const cost = formatWorkVersionCost(item.totalCost);

    const descriptor = getWorkTypeDescriptor(item);
    const Icon = descriptor.getIcon(item);
    const title =
      descriptor.getTitle(item)?.trim() ||
      descriptor.getIdentifier(item) ||
      item.resourceId ||
      item.id;
    const description = descriptor.getDescription(item);
    const openTarget = descriptor.getOpenTarget(item);
    // The backing task was deleted outside the tool path: the Work lingers as an
    // orphan rendered from its snapshot, and opening the gone task detail 404s, so
    // strip the click affordance and surface a "task deleted" badge.
    const taskDeleted = item.resourceType === 'task' && item.taskDeleted;
    const clickable = !!openTarget && !taskDeleted;

    const handleOpen = () => {
      if (onOpen) {
        onOpen(item);
        return;
      }
      if (!openTarget) return;

      switch (openTarget.kind) {
        case 'document': {
          openDocument(openTarget.documentId, openTarget.agentDocumentId);
          return;
        }
        case 'external': {
          // Defense in depth: only ever hand http(s) to shell.openExternal.
          if (isSafeExternalUrl(openTarget.url))
            window.open(openTarget.url, '_blank', 'noopener,noreferrer');
          return;
        }
        case 'task': {
          openTaskDetail(openTarget.identifier);
        }
      }
    };

    if (variant === 'inline') {
      return (
        <Flexbox
          horizontal
          align={'center'}
          className={cx(styles.inline, clickable && styles.inlineClickable, className)}
          gap={10}
          onClick={clickable ? handleOpen : undefined}
        >
          <Icon className={styles.inlineIcon} size={17} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
              <Text ellipsis className={styles.inlineTitle}>
                {title}
              </Text>
              {taskDeleted && (
                <Tag color={'warning'} icon={<Trash2Icon size={12} />} size={'small'}>
                  {t('workingPanel.works.taskDeleted')}
                </Tag>
              )}
            </Flexbox>
            {description && (
              <Text ellipsis className={styles.inlineDescription}>
                {description}
              </Text>
            )}
          </Flexbox>
          {cost && (
            <span className={styles.inlineCost} title={t('workingPanel.works.totalCost', { cost })}>
              {cost}
            </span>
          )}
        </Flexbox>
      );
    }

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.card, clickable && styles.clickable, className)}
        gap={12}
        onClick={clickable ? handleOpen : undefined}
      >
        <Flexbox align={'center'} className={styles.icon} justify={'center'}>
          <Icon size={18} />
        </Flexbox>
        <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
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
          {description && (
            <Text ellipsis className={styles.description} fontSize={13}>
              {description}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

WorkSummaryCard.displayName = 'WorkSummaryCard';

export default WorkSummaryCard;
