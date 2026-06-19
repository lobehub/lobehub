import { AccordionItem, ActionIcon, Center, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx, keyframes } from 'antd-style';
import {
  FolderClosedIcon,
  FolderOpenIcon,
  HandIcon,
  type LucideIcon,
  PlusIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';
import { isDesktop } from '@/const/version';
import { useCommitWorkingDirectory } from '@/features/ChatInput/ControlBar/useCommitWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import TopicItem from '../../List/Item';
import { type GroupItemComponentProps } from '../GroupedAccordion';
import {
  getProjectTopicStatusCounts,
  hasProjectTopicStatusCounts,
  type ProjectTopicStatusCounts,
} from './statusCounts';

const PROJECT_GROUP_PREFIX = 'project:';

const rippleAnim = keyframes`
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(3);
    opacity: 0;
  }
`;

const styles = createStaticStyles(({ css }) => ({
  statusBadge: css`
    display: inline-flex;
    gap: 2px;
    align-items: center;
    justify-content: center;

    min-width: 20px;
    height: 18px;
    padding-inline: 4px;
    border-radius: 9px;

    font-size: 11px;
    font-weight: 500;
    line-height: 1;
  `,
  statusBadgeError: css`
    color: ${cssVar.colorError};
    background: color-mix(in srgb, ${cssVar.colorError} 14%, transparent);
  `,
  statusBadgeLoading: css`
    color: ${cssVar.colorWarning};
    background: color-mix(in srgb, ${cssVar.colorWarning} 14%, transparent);
  `,
  statusBadgeWaiting: css`
    color: ${cssVar.colorInfo};
    background: color-mix(in srgb, ${cssVar.colorInfo} 14%, transparent);
  `,
  unreadDot: css`
    position: relative;
    z-index: 1;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorInfo};
  `,
  unreadRipple: css`
    position: absolute;
    inset: 0;

    width: 6px;
    height: 6px;
    margin: auto;
    border: 1px solid ${cssVar.colorInfo};
    border-radius: 50%;

    background: transparent;

    animation: ${rippleAnim} 1.8s ease-out infinite;
  `,
  unreadWrapper: css`
    position: relative;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 18px;
  `,
  addTopicAction: css`
    pointer-events: none;

    overflow: hidden;
    display: inline-flex;

    width: 0;

    opacity: 0;

    transition:
      width 150ms ${cssVar.motionEaseOut},
      opacity 150ms ${cssVar.motionEaseOut};

    &:focus-within,
    .accordion-header:hover & {
      pointer-events: auto;
      width: 24px;
      opacity: 1;
    }
  `,
}));

interface StatusBadgeConfig {
  className: string;
  count: number;
  icon?: LucideIcon;
  label: string;
  loading?: boolean;
}

const CollapsedStatusBadges = memo<{ counts: ProjectTopicStatusCounts }>(({ counts }) => {
  const { t } = useTranslation('topic');

  const items: StatusBadgeConfig[] = [
    {
      className: styles.statusBadgeLoading,
      count: counts.loading,
      label: t('projectStatus.loading', { count: counts.loading }),
      loading: true,
    },
    {
      className: styles.statusBadgeWaiting,
      count: counts.waitingForHuman,
      icon: HandIcon,
      label: t('projectStatus.waitingForHuman', { count: counts.waitingForHuman }),
    },
    {
      className: styles.statusBadgeError,
      count: counts.failed,
      icon: TriangleAlertIcon,
      label: t('projectStatus.failed', { count: counts.failed }),
    },
  ].filter((item) => item.count > 0);

  if (items.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} gap={3}>
      {items.map(({ className, count, icon, label, loading }) => (
        <Tooltip key={label} title={label}>
          <span aria-label={label} className={cx(styles.statusBadge, className)} role="status">
            {loading ? (
              <RingLoadingIcon
                ringColor={`color-mix(in srgb, ${cssVar.colorWarning} 28%, transparent)`}
                size={11}
                style={{ color: cssVar.colorWarning }}
              />
            ) : (
              icon && <Icon icon={icon} size={{ size: 11, strokeWidth: 2 }} />
            )}
            {count}
          </span>
        </Tooltip>
      ))}
    </Flexbox>
  );
});

CollapsedStatusBadges.displayName = 'CollapsedProjectStatusBadges';

const CollapsedUnreadDot = memo<{ count: number }>(({ count }) => {
  const { t } = useTranslation('topic');
  const label = t('projectStatus.unread', { count });

  return (
    <Tooltip title={label}>
      <span aria-label={label} className={styles.unreadWrapper} role="status">
        <span className={styles.unreadRipple} />
        <span className={styles.unreadDot} />
      </span>
    </Tooltip>
  );
});

CollapsedUnreadDot.displayName = 'CollapsedProjectUnreadDot';

const GroupItem = memo<GroupItemComponentProps>(
  ({ group, activeTopicId, activeThreadId, expanded }) => {
    const { t } = useTranslation('topic');
    const { id, title, children } = group;

    const workingDirectory = useMemo(
      () =>
        id.startsWith(PROJECT_GROUP_PREFIX) ? id.slice(PROJECT_GROUP_PREFIX.length) : undefined,
      [id],
    );

    const agentId = useAgentStore((s) => s.activeAgentId);
    const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId ?? ''));
    const isHeterogeneous = useAgentStore((s) =>
      agentId ? agentByIdSelectors.isAgentHeterogeneousById(agentId)(s) : false,
    );
    const { commitAgentDefault } = useCommitWorkingDirectory(agentId ?? '');

    const handleAddTopic = useCallback(async () => {
      if (!workingDirectory || !agentId) return;
      // Write the agent's per-device default so the new topic inherits this
      // directory at creation time — the same high-precedence slot the picker
      // uses, not the legacy per-agent fallback that gets shadowed by it.
      await commitAgentDefault(workingDirectory);
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    }, [workingDirectory, agentId, commitAgentDefault]);

    // Web can add a topic in a directory too when the agent targets a bound
    // device — the write goes to `workingDirByDevice`, no Electron dependency.
    const effectiveTarget = resolveExecutionTarget(agencyConfig, {
      isHetero: isHeterogeneous,
      clientExecutionAvailable: isDesktop,
    });
    const isDeviceMode = effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId;
    const canAddTopic = (isDesktop || isDeviceMode) && !!workingDirectory;

    const loadingTopicIds = useChatStore((s) => s.topicLoadingIds);
    const statusCounts = useMemo(
      () => getProjectTopicStatusCounts(children, new Set(loadingTopicIds)),
      [children, loadingTopicIds],
    );
    const childTopicIds = useMemo(() => children.map((topic) => topic.id), [children]);
    const unreadCount = useChatStore(
      operationSelectors.unreadCompletedCountForTopics(childTopicIds),
    );
    const hasCollapsedStatus = !expanded && hasProjectTopicStatusCounts(statusCounts);
    const hasCollapsedUnread = !expanded && unreadCount > 0;
    const hasCollapsedIndicators = hasCollapsedStatus || hasCollapsedUnread;
    const ProjectFolderIcon = expanded ? FolderOpenIcon : FolderClosedIcon;
    const action =
      canAddTopic || hasCollapsedIndicators ? (
        <Flexbox horizontal align={'center'} gap={4}>
          {hasCollapsedStatus && <CollapsedStatusBadges counts={statusCounts} />}
          {hasCollapsedUnread && <CollapsedUnreadDot count={unreadCount} />}
          {canAddTopic && (
            <span className={hasCollapsedIndicators ? styles.addTopicAction : undefined}>
              <ActionIcon
                icon={PlusIcon}
                size={'small'}
                title={t('actions.addNewTopicInProject', { directory: title })}
                tooltipProps={{ placement: 'right' }}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleAddTopic();
                }}
              />
            </span>
          )}
        </Flexbox>
      ) : undefined;

    return (
      <AccordionItem
        action={action}
        alwaysShowAction={hasCollapsedIndicators}
        itemKey={id}
        paddingBlock={4}
        paddingInline={4}
        title={
          <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
            <Center flex={'none'} height={24} width={28}>
              <Icon
                color={cssVar.colorTextTertiary}
                icon={ProjectFolderIcon}
                size={{ size: 15, strokeWidth: 1.5 }}
              />
            </Center>
            <Text ellipsis fontSize={14} style={{ color: cssVar.colorTextSecondary, flex: 1 }}>
              {title}
            </Text>
          </Flexbox>
        }
      >
        <Flexbox gap={1} paddingBlock={1}>
          {children.map((topic) => (
            <TopicItem
              active={activeTopicId === topic.id}
              fav={topic.favorite}
              id={topic.id}
              key={topic.id}
              metadata={topic.metadata}
              status={topic.status}
              threadId={activeThreadId}
              title={topic.title}
            />
          ))}
        </Flexbox>
      </AccordionItem>
    );
  },
);

export default GroupItem;
