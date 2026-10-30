import { AGENT_CHAT_URL } from '@lobechat/const';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Center,
  cssVar,
  cx,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  toast,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import {
  Archive,
  FolderClosedIcon,
  FolderOpenIcon,
  ListFilter,
  LucideCheck,
  PlusIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import TailMarquee from '@/components/TailMarquee';
import { useCommitWorkingDirectory } from '@/features/ChatInput/ControlBar/useCommitWorkingDirectory';
import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { AgentDirectoryActions } from '@/features/Projects/WorkingDirectories/AgentDirectoryActions';
import { canStageDraftOn } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';
import { useAgentFixedDeviceId } from '@/features/Projects/WorkingDirectories/useAgentFixedDeviceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { type ProjectTopicSubGroupMode } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { getTopicWorkingDirectorySourcePath } from '@/utils/client/topic';

import { buildPrefixedAgentRoutePath, parseAgentPathname } from '../../../utils/agentPathname';
import { useTopicListScope } from '../../TopicListScope';
import { getMergedPullRequestTopics } from '../../utils/mergedPullRequestTopics';
import { type GroupItemComponentProps } from '../GroupedAccordion';
import { indicatorStyles, useCollapsedIndicators } from './CollapsedIndicators';
import { accordionHeaderMarker } from './markers.stylex';
import ProjectTopicList from './ProjectTopicList';

const PROJECT_GROUP_PREFIX = 'project:';
const PROJECT_ID_GROUP_PREFIX = 'project-id:';
const SUB_GROUP_MODES: ProjectTopicSubGroupMode[] = ['none', 'byDevice', 'byTime', 'byStatus'];
// A plain folder lives on one machine, so sectioning it by device says nothing.
const FOLDER_SUB_GROUP_MODES = SUB_GROUP_MODES.filter((mode) => mode !== 'byDevice');

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

  const handleAddTopic = useCallback(
    async (projectWorkingDirectoryId?: string) => {
      if (!workingDirectory || !currentAgentId || !targetAgentId) return;
      // Write the agent's per-device default so the new topic inherits this
      // directory at creation time — the same high-precedence slot the picker
      // uses, not the legacy per-agent fallback that gets shadowed by it.
      await commitAgentDefault(workingDirectory);
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
      // No topic row is created here — the first message creates it. Stage the
      // project directory so that creation binds the deferred row to the
      // project (list, sidebar grouping and execution routing), instead of
      // dropping it into a path-only conversation.
      useChatStore
        .getState()
        .setPendingNewTopicDirectory(
          projectWorkingDirectoryId
            ? { agentId: targetAgentId, projectWorkingDirectoryId }
            : undefined,
        );
      router.push(
        buildPrefixedAgentRoutePath(AGENT_CHAT_URL(targetAgentId), agentRoute, activeWorkspaceSlug),
      );
    },
    [
      workingDirectory,
      currentAgentId,
      targetAgentId,
      commitAgentDefault,
      router,
      agentRoute,
      activeWorkspaceSlug,
    ],
  );

  // A merged project group may span several machines, so there is no single
  // directory to commit to the agent. It still has to open the blank composer
  // INSIDE the project: stage one runnable directory — the agent's current
  // device first — so the first send binds the new topic to the project, and
  // let the user move to another machine in the composer's device switcher.
  // Staging nothing (the old behaviour) dropped the topic into a path-only
  // conversation, detached from the project the "+" belonged to. No directory
  // can run it → fall back to the plain composer, as before.
  const fixedDeviceId = useAgentFixedDeviceId(targetAgentId);
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(targetAgentId ?? '', {
    topicId: null,
  });
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const handleStartPlain = useCallback(() => {
    if (!currentAgentId || !targetAgentId) return;
    const runnable = projectDirectories.filter((d) => canStageDraftOn(d, fixedDeviceId));
    const preferredDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
      workspaceScoped,
    });
    const stagedDirectory =
      runnable.find((d) => preferredDeviceId && d.deviceId === preferredDeviceId) ?? runnable[0];
    useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    useChatStore
      .getState()
      .setPendingNewTopicDirectory(
        stagedDirectory
          ? { agentId: targetAgentId, projectWorkingDirectoryId: stagedDirectory.id }
          : undefined,
      );
    router.push(
      buildPrefixedAgentRoutePath(AGENT_CHAT_URL(targetAgentId), agentRoute, activeWorkspaceSlug),
    );
  }, [
    currentAgentId,
    targetAgentId,
    projectDirectories,
    fixedDeviceId,
    agencyConfig,
    currentDeviceId,
    workspaceScoped,
    router,
    agentRoute,
    activeWorkspaceSlug,
  ]);

  // Start on one specific project directory — the device sub-group "+". The
  // directory pins the device, so nothing is committed to the agent default.
  const handleStartInDirectory = useCallback(
    (projectWorkingDirectoryId: string) => {
      if (!targetAgentId) return;
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
      useChatStore
        .getState()
        .setPendingNewTopicDirectory({ agentId: targetAgentId, projectWorkingDirectoryId });
      router.push(
        buildPrefixedAgentRoutePath(AGENT_CHAT_URL(targetAgentId), agentRoute, activeWorkspaceSlug),
      );
    },
    [targetAgentId, router, agentRoute, activeWorkspaceSlug],
  );

  const canAddTopic = !scope && !!currentAgentId && !!workingDirectory;
  const needsPlainStart = !!projectId && projectDirectories.length > 1;
  const { t: tProject } = useTranslation('project');

  const isProjectGroup = !!projectId || !!children[0]?.projectWorkingDirectoryId;
  const subGroupModes = isProjectGroup ? SUB_GROUP_MODES : FOLDER_SUB_GROUP_MODES;
  const storedSubGroupMode = useGlobalStore(systemStatusSelectors.projectTopicSubGroupMode(id));
  const subGroupMode = subGroupModes.includes(storedSubGroupMode) ? storedSubGroupMode : 'none';
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const subGroupMenuItems = useMemo<DropdownItem[]>(
    () => [
      {
        children: subGroupModes.map((mode) => ({
          icon: subGroupMode === mode ? <Icon icon={LucideCheck} /> : <div />,
          key: `sub-group-${mode}`,
          label: tProject(`topics.subGroup.${mode}`),
          onClick: () => updateSystemStatus({ projectTopicSubGroupModeByGroup: { [id]: mode } }),
        })),
        key: 'sub-group',
        label: tProject('topics.subGroup.title'),
        type: 'group',
      },
    ],
    [id, subGroupModes, subGroupMode, tProject, updateSystemStatus],
  );

  // "Archive merged PR topics", scoped to this group — a workspace member only
  // archives their own topics, same as the sidebar-wide action.
  const { t } = useTranslation('topic');
  const activeWorkspaceId = useActiveWorkspaceId();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { allowed: canEditTopic } = usePermission('edit_own_content');
  const archiveMenuItems = useMemo<DropdownItem[]>(
    () => [
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Archive} />,
        key: 'archiveMergedPullRequests',
        label: t(
          activeWorkspaceId
            ? 'actions.archiveMergedPullRequestsOwn'
            : 'actions.archiveMergedPullRequests',
        ),
        onClick: async () => {
          const merged = getMergedPullRequestTopics(
            children,
            activeWorkspaceId ? (currentUserId ?? null) : undefined,
          );
          if (merged.length === 0) {
            toast.info(t('actions.archiveMergedPullRequestsNone'));
            return;
          }
          const { refreshTopic, updateTopicStatus } = useChatStore.getState();
          await Promise.all(
            merged.map(({ id }) => updateTopicStatus({ status: 'completed', topicId: id })),
          );
          await refreshTopic();
          toast.success(t('actions.archiveMergedPullRequestsSuccess', { count: merged.length }));
        },
      },
    ],
    [activeWorkspaceId, canEditTopic, children, currentUserId, t],
  );

  const { hasIndicators: hasCollapsedIndicators, indicators } = useCollapsedIndicators(
    children,
    expanded,
  );
  const ProjectFolderIcon = expanded ? FolderOpenIcon : FolderClosedIcon;
  // Sub-grouping is its own row action: it needs no directory, so it stays
  // available even when the directory actions below can't render. The buttons
  // collapse to zero width until the row is hovered, so a resting title gets
  // the full row instead of a gap reserved for invisible actions.
  const action = (
    <Flexbox horizontal align={'center'} gap={4}>
      {indicators}
      <span {...stylex.props(indicatorStyles.hoverActions)}>
        <DropdownMenu items={subGroupMenuItems}>
          <ActionIcon
            icon={ListFilter}
            size={'small'}
            title={tProject('topics.subGroup.title')}
            onClick={(e) => e.stopPropagation()}
          />
        </DropdownMenu>
        {!canAddTopic ? null : needsPlainStart ? (
          <>
            <AgentDirectoryActions
              hideStartAction
              agentId={currentAgentId!}
              extraMenuItems={archiveMenuItems}
              path={workingDirectory!}
              topics={children}
              onLegacyStart={handleAddTopic}
            />
            <ActionIcon
              icon={PlusIcon}
              size={'small'}
              title={tProject('directories.start')}
              onClick={(e) => {
                e.stopPropagation();
                handleStartPlain();
              }}
            />
          </>
        ) : (
          <AgentDirectoryActions
            agentId={currentAgentId!}
            extraMenuItems={archiveMenuItems}
            path={workingDirectory!}
            pathOnly={!isProjectGroup}
            topics={children}
            onLegacyStart={handleAddTopic}
          />
        )}
      </span>
    </Flexbox>
  );

  return (
    <AccordionItem value={id}>
      <AccordionHeader
        className={cx('accordion-header', stylex.props(accordionHeaderMarker).className)}
      >
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: 4 }}>
          <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
            <Center flex="none" height={24} width={28}>
              {project ? (
                <ProjectAvatar
                  avatar={project.projectAvatar}
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
            {project ? (
              <Text ellipsis fontSize={14} style={{ color: cssVar.colorText, flex: 1 }}>
                {scope ? (
                  title
                ) : (
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
                )}
              </Text>
            ) : (
              // A bare path reads from its end: keep the tail in view and
              // scroll to the head on hover.
              <TailMarquee style={{ color: cssVar.colorTextSecondary, fontSize: 14 }}>
                {title}
              </TailMarquee>
            )}
          </Flexbox>
        </AccordionTrigger>
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
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <ProjectTopicList
          mode={subGroupMode}
          startAgentId={targetAgentId}
          startDirectories={projectId ? projectDirectories : project ? [project] : undefined}
          topics={children}
          onStartInDirectory={!scope && targetAgentId ? handleStartInDirectory : undefined}
        />
      </AccordionPanel>
    </AccordionItem>
  );
}, isEqual);

GroupItem.displayName = 'TopicByProjectGroupItem';

export default GroupItem;
