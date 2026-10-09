import { AGENT_CHAT_URL } from '@lobechat/const';
import { Center, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Text,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { FolderClosedIcon, FolderOpenIcon, type LucideIcon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import Avatar from '@/components/Avatar';
import { TOPIC_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RingLoadingIcon from '@/components/RingLoading';
import UnreadDot from '@/components/UnreadDot';
import { useCommitWorkingDirectory } from '@/features/ChatInput/ControlBar/useCommitWorkingDirectory';
import { AgentDirectoryActions } from '@/features/Projects/WorkingDirectories/AgentDirectoryActions';
import { openProjectTopicModal } from '@/features/Projects/WorkingDirectories/StartDirectoryModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import { getTopicWorkingDirectorySourcePath } from '@/utils/client/topic';

import { buildPrefixedAgentRoutePath, parseAgentPathname } from '../../../utils/agentPathname';
import TopicItem from '../../List/Item';
import { useTopicListScope } from '../../TopicListScope';
import { type GroupItemComponentProps } from '../GroupedAccordion';
import {
  getProjectTopicStatusCounts,
  hasProjectTopicStatusCounts,
  type ProjectTopicStatusCounts,
} from './statusCounts';

const PROJECT_GROUP_PREFIX = 'project:';
const PROJECT_ID_GROUP_PREFIX = 'project-id:';

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
      icon: TOPIC_STATUS_VISUALS.waitingForHuman.icon,
      label: t('projectStatus.waitingForHuman', { count: counts.waitingForHuman }),
    },
    {
      className: styles.statusBadgeError,
      count: counts.failed,
      icon: TOPIC_STATUS_VISUALS.failed.icon,
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
      <UnreadDot label={label} />
    </Tooltip>
  );
});

CollapsedUnreadDot.displayName = 'CollapsedProjectUnreadDot';

const GroupItem = memo<GroupItemComponentProps>(({ group, expanded }) => {
  const { id, title, children } = group;
  const scope = useTopicListScope();
  const navigate = useWorkspaceAwareNavigate();
  // `project-id:` groups merge every directory of one project — resolve the
  // project through any of its directories; directory/path groups keep the
  // first child's exact directory so a shared path can't cross projects.
  const projectId = id.startsWith(PROJECT_ID_GROUP_PREFIX)
    ? id.slice(PROJECT_ID_GROUP_PREFIX.length)
    : undefined;
  useProjectDirectoryStore((s) => s.useFetchDirectories)(
    undefined,
    !!children[0]?.projectWorkingDirectoryId || !!projectId,
  );
  const directories = useProjectDirectories();
  const project = projectId
    ? directories.find((d) => d.projectId === projectId)
    : directories.find((d) => d.id === children[0]?.projectWorkingDirectoryId);
  const projectDirectories = useMemo(
    () => (projectId ? directories.filter((d) => d.projectId === projectId) : []),
    [directories, projectId],
  );

  const workingDirectory = useMemo(
    () =>
      (children[0] ? getTopicWorkingDirectorySourcePath(children[0]) : undefined) ??
      (id.startsWith(PROJECT_GROUP_PREFIX) ? id.slice(PROJECT_GROUP_PREFIX.length) : undefined),
    [id, children],
  );

  const agentId = useAgentStore((s) => s.activeAgentId);
  const { aid: routeAgentId } = useActiveRouteParams<{ aid?: string }>();
  const { pathname } = useActiveLocation();
  const agentRoute = useMemo(() => parseAgentPathname(pathname), [pathname]);
  const targetAgentId = routeAgentId ?? agentRoute?.agentId ?? agentId;
  const currentAgentId = targetAgentId ?? agentId;
  const router = useQueryRoute();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { commitAgentDefault } = useCommitWorkingDirectory(currentAgentId ?? '');

  const handleAddTopic = useCallback(async () => {
    if (!workingDirectory || !currentAgentId || !targetAgentId) return;
    // Write the agent's per-device default so the new topic inherits this
    // directory at creation time — the same high-precedence slot the picker
    // uses, not the legacy per-agent fallback that gets shadowed by it.
    await commitAgentDefault(workingDirectory);
    useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    router.push(
      buildPrefixedAgentRoutePath(AGENT_CHAT_URL(targetAgentId), agentRoute, activeWorkspaceSlug),
    );
  }, [
    workingDirectory,
    currentAgentId,
    targetAgentId,
    commitAgentDefault,
    router,
    agentRoute,
    activeWorkspaceSlug,
  ]);

  const canAddTopic = !scope && !!currentAgentId && !!workingDirectory;
  // A merged project group may span several machines. Starting work from it
  // must let the user pick the execution context (this machine / another
  // computer / conversation only) instead of silently taking the most recent
  // directory's device; single-directory groups keep the direct start.
  const needsStartChooser = !!projectId && projectDirectories.length > 1;
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(
    undefined,
    needsStartChooser,
  );
  const { t: tProject } = useTranslation('project');
  const openStartChooser = useCallback(() => {
    if (!projectId || !currentAgentId) return;
    openProjectTopicModal({
      title: tProject('sidebar.newConversation'),
      coordinatorAgentId: currentAgentId,
      directories: projectDirectories,
      projectId,
    });
  }, [projectId, currentAgentId, projectDirectories, tProject]);

  const statusCounts = useChatStore(
    (s) => getProjectTopicStatusCounts(children, operationSelectors.visiblyRunningTopicIds(s)),
    isEqual,
  );
  const childTopicIds = useMemo(() => children.map((topic) => topic.id), [children]);
  const unreadCount = useChatStore(operationSelectors.unreadCompletedCountForTopics(childTopicIds));
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
            {needsStartChooser ? (
              <>
                <AgentDirectoryActions
                  hideStartAction
                  agentId={currentAgentId!}
                  path={workingDirectory!}
                  topics={children}
                  onLegacyStart={handleAddTopic}
                />
                <ActionIcon
                  disabled={!directoriesRequest.hasData || !!directoriesRequest.error}
                  icon={PlusIcon}
                  size={'small'}
                  title={tProject('directories.start')}
                  onClick={(e) => {
                    e.stopPropagation();
                    openStartChooser();
                  }}
                />
              </>
            ) : (
              <AgentDirectoryActions
                agentId={currentAgentId!}
                path={workingDirectory!}
                topics={children}
                onLegacyStart={handleAddTopic}
              />
            )}
          </span>
        )}
      </Flexbox>
    ) : undefined;

  return (
    <AccordionItem value={id}>
      <AccordionHeader className={'accordion-header'}>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: 4 }}>
          <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
            <Center flex="none" height={24} width={28}>
              {project ? (
                <Avatar
                  avatar={project.projectAvatar || undefined}
                  name={project.projectName}
                  size={18}
                />
              ) : (
                <Icon
                  color={cssVar.colorTextTertiary}
                  icon={ProjectFolderIcon}
                  size={{ size: 15, strokeWidth: 1.5 }}
                />
              )}
            </Center>
            <Text
              ellipsis
              fontSize={14}
              style={{ color: project ? cssVar.colorText : cssVar.colorTextSecondary, flex: 1 }}
            >
              {project && !scope ? (
                <a
                  style={{ color: 'inherit', textDecoration: 'none' }}
                  href={buildWorkspaceAwarePath(
                    `/project/${project.projectSlug ?? project.projectId}`,
                    activeWorkspaceSlug,
                  )}
                  onClick={(event) => {
                    // Keep the accordion closed either way; leave modified clicks
                    // (new tab / window) to the browser's native link handling.
                    event.stopPropagation();
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    navigate(`/project/${project.projectSlug ?? project.projectId}`);
                  }}
                >
                  {project.projectName}
                </a>
              ) : (
                title
              )}
            </Text>
          </Flexbox>
        </AccordionTrigger>
        {action && (
          <div
            className={cx(
              'accordion-action',
              accordionStyles.action,
              accordionStyles.actionBorderless,
              hasCollapsedIndicators && accordionStyles.actionAlwaysVisible,
            )}
          >
            {action}
          </div>
        )}
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Flexbox gap={1} paddingBlock={1}>
          {children.map((topic) => (
            <TopicItem
              fav={topic.favorite}
              id={topic.id}
              key={topic.id}
              metadata={topic.metadata}
              runStartedAt={topic.runStartedAt}
              status={topic.status}
              title={topic.title}
              userId={topic.userId}
            />
          ))}
        </Flexbox>
      </AccordionPanel>
    </AccordionItem>
  );
}, isEqual);

GroupItem.displayName = 'TopicByProjectGroupItem';

export default GroupItem;
