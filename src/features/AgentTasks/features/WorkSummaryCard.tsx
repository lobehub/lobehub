'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ClipboardListIcon, FileTextIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

import LinearIcon from './icons/LinearIcon';

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
  icon: css`
    flex-shrink: 0;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  description: css`
    min-width: 0;
    color: ${cssVar.colorTextTertiary};
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
}

const WorkSummaryCard = memo<WorkSummaryCardProps>(({ className, item, onOpen }) => {
  const { t } = useTranslation('chat');
  const openDocument = useChatStore((s) => s.openDocument);
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const cost = formatWorkVersionCost(item.totalCost);
  const isDocument = item.type === 'document';
  const isLinear = item.type === 'linear';
  const isGithub = item.type === 'github';
  // Display name comes straight from the resource snapshot (task name is live
  // from the tasks join). No synthesized fallback title: a nameless resource
  // deliberately shows its bare identifier so data gaps stay visible.
  const snapshotTitle = isDocument
    ? item.document.title
    : isLinear
      ? item.linear.title
      : isGithub
        ? item.github.title
        : item.task.name;
  const title = snapshotTitle?.trim() || item.resourceIdentifier || item.resourceId;
  // Summary payloads slim long free-text (linear content / github body / task
  // instruction capped server-side); prefer description, then short
  // body/status — never full docs.
  const description = isDocument
    ? item.document.description?.trim()
    : isLinear
      ? (item.linear.description || item.linear.status)?.trim()
      : isGithub
        ? (item.github.body || item.github.state)?.trim()
        : item.task.instruction?.trim();
  const Icon = isDocument
    ? FileTextIcon
    : isLinear
      ? LinearIcon
      : isGithub
        ? Github
        : ClipboardListIcon;
  // Linear/github works registered from CLI results may carry no URL — those
  // cards have nothing to open, so drop the click affordance entirely.
  const externalUrl = isLinear ? item.linear.url : isGithub ? item.github.url : undefined;
  // The backing task was deleted outside the tool path: the Work lingers as an
  // orphan rendered from its snapshot, and opening the gone task detail 404s, so
  // strip the click affordance and surface a "task deleted" badge.
  const taskDeleted = item.resourceType === 'task' && item.taskDeleted;
  const clickable = (isDocument || (!isLinear && !isGithub) || !!externalUrl) && !taskDeleted;
  const handleOpen = () => {
    if (onOpen) {
      onOpen(item);
      return;
    }

    if (isDocument) {
      openDocument(item.document.id, item.event.metadata?.agentDocumentId);
      return;
    }

    if (isLinear || isGithub) {
      if (externalUrl) window.open(externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    openTaskDetail(item.resourceIdentifier ?? item.resourceId);
  };

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
              title={t('workingPanel.works.cumulativeCost', { cost })}
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
});

WorkSummaryCard.displayName = 'WorkSummaryCard';

export default WorkSummaryCard;
