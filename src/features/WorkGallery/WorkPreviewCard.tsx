'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { formatTokenNumber } from '@lobechat/utils/format';
import { Flexbox } from '@lobehub/ui';
import { Avatar, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTaskItemDate } from '@/features/AgentTasks/features/formatTaskItemDate';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { getWorkTypeDescriptor } from '@/features/Work/descriptors';
import { getWorkVersionTotalTokens } from '@/utils/workCumulativeUsage';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

import WorkPreview from './WorkPreview';

const styles = createStaticStyles(({ css }) => ({
  agentAvatar: css`
    align-self: flex-start;
    margin-block-start: 2px;
  `,
  agentName: css`
    overflow: hidden;
    flex: none;

    max-width: 64px;

    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  card: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};

    transition:
      transform ${cssVar.motionDurationFast},
      border-color ${cssVar.motionDurationFast},
      box-shadow ${cssVar.motionDurationFast};
  `,
  cardInfo: css`
    padding-block: 8px 12px;
    padding-inline: 12px;
  `,
  clickable: css`
    cursor: pointer;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  footer: css`
    overflow: hidden;
    margin-block-start: 8px;
  `,
  identityMeta: css`
    flex: 1;
    min-width: 0;
  `,
  identifier: css`
    overflow: hidden;

    min-width: 0;

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  metaRow: css`
    min-width: 0;
  `,
  meta: css`
    flex: none;
    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
  `,
  originTopic: css`
    overflow: hidden;

    min-width: 0;

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    overflow: hidden;

    margin-block-start: 5px;

    font-size: 15px;
    font-weight: 650;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  type: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  usage: css`
    flex: none;

    margin-inline-start: auto;

    font-size: 10px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
}));

interface WorkPreviewCardProps {
  item: WorkSummaryItem;
  onOpen: (item: WorkSummaryItem) => void;
}

const workTypeKey = (item: WorkSummaryItem) => {
  switch (item.resourceType) {
    case 'document': {
      return 'work.type.document';
    }
    case 'file': {
      return 'work.type.file';
    }
    case 'github_issue': {
      return 'work.type.githubIssue';
    }
    case 'github_pull_request': {
      return 'work.type.githubPullRequest';
    }
    case 'linear_document': {
      return 'work.type.linearDocument';
    }
    case 'linear_issue': {
      return 'work.type.linearIssue';
    }
    case 'task': {
      return 'work.type.task';
    }
  }
};

const WorkPreviewCard = memo<WorkPreviewCardProps>(({ item, onOpen }) => {
  const { t, i18n } = useTranslation(['chat', 'common', 'file']);
  const agent = useAgentDisplayMeta(item.originAgentId);
  const descriptor = getWorkTypeDescriptor(item);
  const title =
    descriptor.getTitle(item)?.trim() ||
    descriptor.getIdentifier(item) ||
    item.resourceId ||
    item.id;
  const identifier = descriptor.getIdentifier(item);
  const displayIdentifier =
    item.resourceType.startsWith('github_') && identifier?.includes('#')
      ? `#${identifier.split('#').at(-1)}`
      : identifier;
  const taskDeleted = item.resourceType === 'task' && item.taskDeleted;
  const openTarget = descriptor.getOpenTarget(item);
  const actionable = !!openTarget && (openTarget.kind !== 'filePreview' || !!openTarget.url);
  const clickable = actionable && !taskDeleted;
  const eventDate = item.event.changeType === 'created' ? item.createdAt : item.updatedAt;
  const eventAt = formatTaskItemDate(eventDate, {
    formatOtherYear: t('time.formatOtherYear', { ns: 'common' }),
    formatThisYear: t('time.formatThisYear', { ns: 'common' }),
    locale: i18n.language,
  });
  const eventTime = t(item.event.changeType === 'created' ? 'work.createdAt' : 'work.updatedAt', {
    date: eventAt,
    ns: 'file',
  });
  const totalTokens = getWorkVersionTotalTokens(item.event.cumulativeUsage);
  const cost = formatWorkVersionCost(item.totalCost);

  return (
    <Flexbox
      className={cx(styles.card, clickable && styles.clickable)}
      onClick={clickable ? () => onOpen(item) : undefined}
    >
      <WorkPreview item={item} title={title} />
      <div className={styles.cardInfo}>
        <Flexbox horizontal align={'center'} className={styles.metaRow} gap={6}>
          <span className={styles.type}>{t(workTypeKey(item), { ns: 'file' })}</span>
          {displayIdentifier &&
            item.resourceType !== 'document' &&
            item.resourceType !== 'github_pull_request' &&
            item.resourceType !== 'linear_issue' && (
              <Flexbox horizontal align={'center'} className={styles.identifier} gap={3}>
                {displayIdentifier}
              </Flexbox>
            )}
          {item.resourceType === 'github_issue' && item.status && (
            <Tag size={'small'} style={{ marginInlineStart: 'auto' }}>
              {item.status}
            </Tag>
          )}
          {taskDeleted && (
            <Tag color={'warning'} icon={<Trash2Icon size={12} />} size={'small'}>
              {t('workingPanel.works.taskDeleted', { ns: 'chat' })}
            </Tag>
          )}
        </Flexbox>
        <div className={styles.title}>{title}</div>
        <Flexbox horizontal align={'baseline'} className={styles.footer} gap={7}>
          {agent && (
            <>
              <Avatar
                emojiScaleWithBackground
                avatar={agent.avatar}
                background={agent.backgroundColor}
                className={styles.agentAvatar}
                shape={'square'}
                size={24}
              />
              <Flexbox className={styles.identityMeta} gap={1}>
                <Flexbox horizontal align={'baseline'} gap={7}>
                  <span className={styles.agentName}>{agent.title}</span>
                  <span className={styles.meta}>{eventTime}</span>
                </Flexbox>
                {item.originTopicTitle && (
                  <div className={styles.originTopic}>
                    {t('work.fromTopic', { ns: 'file', topic: item.originTopicTitle })}
                  </div>
                )}
              </Flexbox>
            </>
          )}
          {!agent && (
            <Flexbox className={styles.identityMeta} gap={1}>
              <span className={styles.meta}>{eventTime}</span>
              {item.originTopicTitle && (
                <div className={styles.originTopic}>
                  {t('work.fromTopic', { ns: 'file', topic: item.originTopicTitle })}
                </div>
              )}
            </Flexbox>
          )}
          {(totalTokens || cost) && (
            <span className={styles.usage}>
              {[totalTokens ? `${formatTokenNumber(totalTokens)} tokens` : null, cost]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

WorkPreviewCard.displayName = 'WorkPreviewCard';

export default WorkPreviewCard;
