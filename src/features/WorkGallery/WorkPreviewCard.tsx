'use client';

import type { CanvasStorageItem, WorkSummaryItem } from '@lobechat/types';
import { formatSize, formatTokenNumber } from '@lobechat/utils/format';
import { ActionIcon, Avatar, cx, DropdownMenu, Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTaskItemDate } from '@/features/AgentTasks/features/formatTaskItemDate';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useCanvasCardMenu } from '@/features/CanvasStorage/useCanvasCardMenu';
import { getWorkTypeDescriptor } from '@/features/Work/descriptors';
import { getWorkVersionTotalTokens } from '@/utils/workCumulativeUsage';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

import WorkPreview from './WorkPreview';

const styles = stylex.create({
  agentAvatar: { alignSelf: 'flex-start', marginBlockStart: '2px' },
  agentName: {
    overflow: 'hidden',
    flex: 'none',
    maxWidth: '64px',
    fontSize: '12px',
    fontWeight: 600,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: `transform ${cssVar.motionDurationFast},
      border-color ${cssVar.motionDurationFast},
      box-shadow ${cssVar.motionDurationFast}`,
  },
  cardInfo: { paddingBlockStart: '8px', paddingBlockEnd: '12px', paddingInline: '12px' },
  clickable: { cursor: 'pointer', borderColor: { 'default': null, ':hover': cssVar.colorBorder } },
  footer: { overflow: 'hidden', marginBlockStart: '8px' },
  identityMeta: { flex: '1', minWidth: '0' },
  identifier: {
    overflow: 'hidden',
    minWidth: '0',
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metaRow: { minWidth: '0' },
  more: { flex: 'none', marginInlineStart: 'auto' },
  meta: { flex: 'none', fontSize: '10px', color: cssVar.colorTextTertiary },
  originTopic: {
    overflow: 'hidden',
    minWidth: '0',
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: {
    overflow: 'hidden',
    marginBlockStart: '5px',
    fontSize: '15px',
    fontWeight: 650,
    lineHeight: 1.4,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  type: { fontSize: '11px', color: cssVar.colorTextTertiary },
  usage: {
    flex: 'none',
    marginInlineStart: 'auto',
    fontSize: '10px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
});

interface WorkPreviewCardProps {
  item: WorkSummaryItem;
  onOpen: (item: WorkSummaryItem) => void;
  /** File storage a canvas Work holds, when it is the caller's own canvas. */
  storage?: CanvasStorageItem;
}

const stopPropagation = (event: MouseEvent) => event.stopPropagation();

const workTypeKey = (item: WorkSummaryItem) => {
  switch (item.resourceType) {
    case 'canvas': {
      return 'work.type.canvas';
    }
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

/**
 * Gallery card for a live Work. Orphans (backing resource deleted or trashed)
 * never reach it: `listByWorkspace` filters them out server-side, so the card
 * has no "resource deleted" state.
 */
const WorkPreviewCard = memo<WorkPreviewCardProps>(({ item, onOpen, storage }) => {
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
  const openTarget = descriptor.getOpenTarget(item);
  const clickable = !!openTarget && (openTarget.kind !== 'filePreview' || !!openTarget.url);
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
  const size = storage ? formatSize(storage.totalSize) : null;
  const menuItems = useCanvasCardMenu(item, storage);

  return (
    <Flexbox
      className={cx(
        stylex.props(styles.card, clickable && styles.clickable).className,
        'work-preview-card',
      )}
      onClick={clickable ? () => onOpen(item) : undefined}
    >
      <WorkPreview item={item} title={title} />
      <div {...stylex.props(styles.cardInfo)}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.metaRow).className}
          gap={6}
        >
          <span {...stylex.props(styles.type)}>{t(workTypeKey(item), { ns: 'file' })}</span>
          {displayIdentifier &&
            item.resourceType !== 'document' &&
            item.resourceType !== 'github_pull_request' &&
            item.resourceType !== 'linear_issue' && (
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.identifier).className}
                gap={3}
              >
                {displayIdentifier}
              </Flexbox>
            )}
          {item.resourceType === 'github_issue' && item.status && (
            <Tag size={'small'} style={{ marginInlineStart: 'auto' }}>
              {item.status}
            </Tag>
          )}
          {menuItems.length > 0 && (
            <div className={stylex.props(styles.more).className} onClick={stopPropagation}>
              <DropdownMenu items={menuItems} placement={'bottomRight'}>
                <ActionIcon
                  icon={MoreHorizontalIcon}
                  size={'small'}
                  title={t('more', { ns: 'common' })}
                  onClick={stopPropagation}
                />
              </DropdownMenu>
            </div>
          )}
        </Flexbox>
        <div {...stylex.props(styles.title)}>{title}</div>
        <Flexbox
          horizontal
          align={'baseline'}
          className={stylex.props(styles.footer).className}
          gap={7}
        >
          {agent && (
            <>
              <Avatar
                emojiScaleWithBackground
                avatar={agent.avatar}
                background={agent.backgroundColor}
                className={stylex.props(styles.agentAvatar).className}
                shape={'square'}
                size={24}
              />
              <Flexbox className={stylex.props(styles.identityMeta).className} gap={1}>
                <Flexbox horizontal align={'baseline'} gap={7}>
                  <span {...stylex.props(styles.agentName)}>{agent.title}</span>
                  <span {...stylex.props(styles.meta)}>{eventTime}</span>
                </Flexbox>
                {item.originTopicTitle && (
                  <div {...stylex.props(styles.originTopic)}>
                    {t('work.fromTopic', { ns: 'file', topic: item.originTopicTitle })}
                  </div>
                )}
              </Flexbox>
            </>
          )}
          {!agent && (
            <Flexbox className={stylex.props(styles.identityMeta).className} gap={1}>
              <span {...stylex.props(styles.meta)}>{eventTime}</span>
              {item.originTopicTitle && (
                <div {...stylex.props(styles.originTopic)}>
                  {t('work.fromTopic', { ns: 'file', topic: item.originTopicTitle })}
                </div>
              )}
            </Flexbox>
          )}
          {(size || totalTokens || cost) && (
            <span className={stylex.props(styles.usage).className}>
              {[size, totalTokens ? `${formatTokenNumber(totalTokens)} tokens` : null, cost]
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
