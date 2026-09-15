import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ChatTopicMetadata, ChatTopicStatus } from '@lobechat/types';
import { formatElapsedClockTime } from '@lobechat/utils';
import {
  getTopicMetadataWorkingDirectoryEffectivePath,
  getTopicMetadataWorkingDirectorySourcePath,
} from '@lobechat/utils/client/topic';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { Skeleton, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useTheme } from 'antd-style';
import dayjs from 'dayjs';
import isEqual from 'fast-deep-equal';
import { MessageSquareDashed } from 'lucide-react';
import type { CSSProperties, DragEvent, RefObject } from 'react';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import DotsLoading from '@/components/DotsLoading';
import { TOPIC_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RingLoadingIcon from '@/components/RingLoading';
import UnreadDot from '@/components/UnreadDot';
import { isDesktop } from '@/const/version';
import { TopicMigrationIndicator } from '@/features/AgentTransferMigration';
import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import { useHasDraft } from '@/features/ChatInput/draftStorage';
import { startTopicDrag } from '@/features/ChatInput/InputEditor/ReferTopic/topicDragData';
import NavItem from '@/features/NavPanel/components/NavItem';
import TopicCreatorAvatar, { useTopicCreator } from '@/features/TopicCreatorAvatar';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { getWorkingDirectoryName } from '@/helpers/workingDirectoryPath';
import { getPlatformIcon } from '@/routes/(main)/agent/channel/const';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useElectronStore } from '@/store/electron';

import { useTopicNavigation } from '../../hooks/useTopicNavigation';
import ThreadList from '../../TopicListContent/ThreadList';
import Actions from './Actions';
import TopicItemContextMenu from './ContextMenu';
import {
  getCiVisual,
  getPullRequestState,
  getTopicMetaCard,
  PR_STATE_VISUAL,
} from './metaCardData';
import MetaHoverCard from './MetaHoverCard';

// Base UI Popover plays an opacity/scale enter+exit transition driven by these
// CSS vars on the positioner. Zero them so the meta hover card appears instantly
// instead of easing in — the hover-intent delay (`mouseEnterDelay`) still gates
// when it shows. `styles.root` maps to the positioner (inline style → wins over
// the library's default without a specificity fight).
const META_HOVER_CARD_STYLES = {
  content: { padding: 12 },
  root: {
    '--lobe-popover-animation-duration': '0ms',
    '--lobe-popover-animation-duration-exit': '0ms',
  } as CSSProperties,
};

const styles = createStaticStyles(({ css }) => ({
  ciBadge: css`
    position: absolute;
    inset-block-end: -3px;
    inset-inline-end: -3px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 10px;
    height: 10px;
    border-radius: 50%;

    line-height: 0;

    background: ${cssVar.colorBgContainer};
  `,
  ciPending: css`
    animation: ci-spin 1s linear infinite;

    @keyframes ci-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  prIcon: css`
    position: relative;
    display: inline-flex;
    flex: none;
  `,
  runningElapsedTime: css`
    flex: none;

    min-width: 42px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
    text-align: end;
  `,
}));

// Module-scoped so a click on any topic cancels a pending click on another.
// Per-item refs can't do that, which lets rapid clicks across items all
// fire — each racing to write activeTopicId (see ).
let pendingSingleClickTimer: ReturnType<typeof setTimeout> | null = null;

const cancelPendingSingleClick = () => {
  if (pendingSingleClickTimer) {
    clearTimeout(pendingSingleClickTimer);
    pendingSingleClickTimer = null;
  }
};

const getWorkingDirectoryDisplay = (metadata: ChatTopicMetadata | undefined) => {
  const config = metadata?.workingDirectoryConfig;
  const workingDirectory = getTopicMetadataWorkingDirectoryEffectivePath(metadata);
  if (!workingDirectory) return;

  const branch = config?.git?.branch;
  const dirName = getWorkingDirectoryName(workingDirectory);
  if (!dirName) return;

  const sourcePath = getTopicMetadataWorkingDirectorySourcePath(metadata);
  const sourceName =
    sourcePath && sourcePath !== workingDirectory ? getWorkingDirectoryName(sourcePath) : undefined;
  const pathLabel = sourceName && sourceName !== dirName ? `${sourceName}/${dirName}` : dirName;

  return {
    label: branch ? `${pathLabel} · ${branch}` : pathLabel,
    repoType: config?.repoType ?? (isDesktop ? undefined : 'github'),
  };
};

interface RunningElapsedTimeProps {
  agentId?: string;
  topicId: string;
}

const RunningElapsedTime = memo<RunningElapsedTimeProps>(({ agentId, topicId }) => {
  const startTime = useChatStore(
    agentId
      ? operationSelectors.getVisibleAgentRuntimeStartTimeByContext({ agentId, topicId })
      : () => undefined,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startTime) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [startTime]);

  if (!startTime) return null;

  return (
    <span className={styles.runningElapsedTime}>{formatElapsedClockTime(now - startTime)}</span>
  );
});

RunningElapsedTime.displayName = 'RunningElapsedTime';

interface TopicItemProps {
  fav?: boolean;
  id?: string;
  metadata?: ChatTopicMetadata;
  /**
   * Show the topic's project directory as a second line under the title. Used by
   * the by-status grouping, where the row otherwise carries no project context
   * (by-project mode already puts the directory in the group header).
   */
  showWorkingDirectory?: boolean;
  status?: ChatTopicStatus | null;
  title: string;
  /** Creator of the topic; drives the workspace creator avatar. */
  userId?: string;
}

type TopicNavigationActions = Pick<
  ReturnType<typeof useTopicNavigation>,
  'focusTopicPopup' | 'navigateToTopic'
>;

interface TopicItemRowProps extends TopicItemProps {
  defaultTopicActive: boolean;
  isTopicActive: boolean;
  navRef: RefObject<TopicNavigationActions>;
  showThreadList: boolean;
}

const TopicItemRow = memo<TopicItemRowProps>(
  ({
    id,
    title,
    fav,
    metadata,
    status,
    showWorkingDirectory,
    userId,
    defaultTopicActive,
    isTopicActive,
    navRef,
    showThreadList,
  }) => {
    const { t } = useTranslation('topic');
    const { isDarkMode } = useTheme();
    // Rows render by the dozen, so agent-level reads share ONE subscription.
    // Only workspace-shared (`public`) agents get the creator avatar — a
    // workspace-private agent's topics all belong to the viewer.
    const [activeAgentId, isSharedAgent] = useAgentStore((s) => [
      s.activeAgentId,
      agentSelectors.currentAgentVisibility(s) === 'public',
    ]);
    const activeWorkspaceSlug = useActiveWorkspaceSlug();
    // Creator of the topic — resolves only inside an active workspace; drives
    // the identity-first icon layout below.
    const author = useTopicCreator(isSharedAgent ? userId : undefined);

    const loadingRingColor = isDarkMode
      ? cssVar.colorWarningBorder
      : `color-mix(in srgb, ${cssVar.colorWarning} 45%, transparent)`;

    // Construct href for cmd+click support
    const href = useMemo(() => {
      if (!activeAgentId || !id) return undefined;
      return buildWorkspaceAwarePath(AGENT_CHAT_TOPIC_URL(activeAgentId, id), activeWorkspaceSlug);
    }, [activeAgentId, activeWorkspaceSlug, id]);

    const [isLoading, isUnreadCompleted, hasLocalRunningRuntime, isRuntimeVisiblyRunning] =
      useChatStore((s) => [
        !!id && operationSelectors.isTopicVisiblyRunning(id)(s),
        !!id && operationSelectors.isTopicUnreadCompleted(id)(s),
        !!id &&
          !!activeAgentId &&
          operationSelectors.isAgentRuntimeRunningByContext({
            agentId: activeAgentId,
            topicId: id,
          })(s),
        !!id &&
          !!activeAgentId &&
          operationSelectors.isAgentRuntimeVisiblyRunningByContext({
            agentId: activeAgentId,
            topicId: id,
          })(s),
      ]);

    const handleDragStart = useCallback(
      (event: DragEvent) => {
        if (!id) return;
        cancelPendingSingleClick();
        startTopicDrag(event, { topicId: id, topicTitle: title });
      },
      [id, title],
    );

    const handleClick = useCallback(() => {
      if (isDesktop) {
        cancelPendingSingleClick();
        pendingSingleClickTimer = setTimeout(() => {
          pendingSingleClickTimer = null;
          void navRef.current.navigateToTopic(id);
        }, 250);
      } else {
        void navRef.current.navigateToTopic(id);
      }
    }, [id, navRef]);

    const handleDoubleClick = useCallback(async () => {
      if (!id || !activeAgentId || !isDesktop) return;
      cancelPendingSingleClick();
      if (await navRef.current.focusTopicPopup(id)) {
        void navRef.current.navigateToTopic(id, { skipPopupFocus: true });
        return;
      }
      useElectronStore
        .getState()
        .addTab(
          buildWorkspaceAwarePath(AGENT_CHAT_TOPIC_URL(activeAgentId, id), activeWorkspaceSlug),
        );
      void navRef.current.navigateToTopic(id);
    }, [id, activeAgentId, activeWorkspaceSlug, navRef]);

    const isFailed = status === 'failed';
    const isRunning = status === 'running';
    const isScheduled = status === 'scheduled';
    const isWaitingForHuman = status === 'waitingForHuman';
    // Post-visible-output tail: the user-visible answer is complete but the run
    // is still doing terminal bookkeeping (unread persist, title summary) —
    // #16518 intentionally masks the running icon during this window.
    const isMaskedRunningTail = isRunning && hasLocalRunningRuntime && !isRuntimeVisiblyRunning;
    const shouldShowRunningIcon = isLoading || (isRunning && !isMaskedRunningTail);

    // By-status grouping mixes topics from different projects, so surface each
    // topic's working directory as a muted second line. Data is already on the
    // topic (`metadata.workingDirectoryConfig` / `workingDirectory`) — no fetch.
    // On web it's a github repo URL; on desktop a local path.
    const workingDirectoryDisplay = useMemo(
      () => (showWorkingDirectory ? getWorkingDirectoryDisplay(metadata) : undefined),
      [metadata, showWorkingDirectory],
    );
    const workingDirectoryNode = workingDirectoryDisplay ? (
      <Flexbox horizontal align={'center'} gap={4} style={{ overflow: 'hidden' }}>
        <DirIcon repoType={workingDirectoryDisplay.repoType} size={13} />
        <Text ellipsis fontSize={12} style={{ color: cssVar.colorTextDescription }}>
          {workingDirectoryDisplay.label}
        </Text>
      </Flexbox>
    ) : undefined;

    // Surface the unread dot right away during the masked tail instead of a
    // blank icon gap until markTopicUnread's persisted 'unread' lands. Skipped
    // while the user is viewing the topic, like markTopicUnread's own guard.
    const isRunningTailUnread = isMaskedRunningTail && !isTopicActive;

    const hasUnread = id && (isUnreadCompleted || isRunningTailUnread);

    useEffect(() => {
      if (!activeAgentId || !id || !isUnreadCompleted || hasLocalRunningRuntime) return;

      void useChatStore
        .getState()
        .prefetchMessages({ agentId: activeAgentId, scope: 'main', topicId: id });
    }, [activeAgentId, hasLocalRunningRuntime, id, isUnreadCompleted]);

    // Surface a WeChat-style red "[Draft]" hint when this topic holds unsent
    // input. Drafts live in localStorage keyed by messageMapKey; the default
    // topic (no id) maps to the new-topic draft. `useHasDraft` re-renders the
    // row only when the draft appears or clears.
    const draftKey = useMemo(
      () => (activeAgentId ? messageMapKey({ agentId: activeAgentId, topicId: id }) : undefined),
      [activeAgentId, id],
    );
    const hasDraft = useHasDraft(draftKey);
    const draftPrefix = hasDraft ? (
      <Text fontSize={12} style={{ color: cssVar.colorError, flex: 'none' }}>
        {t('draft')}
      </Text>
    ) : undefined;

    // Codex-style hover detail card: when the topic carries git context, hovering
    // the row reveals a card on the right with repo / branch / worktree / PR / CI —
    // keeping the row itself clean.
    const metaCard = useMemo(() => getTopicMetaCard(metadata), [metadata]);

    // For default topic (no id)
    if (!id) {
      return (
        <NavItem
          active={defaultTopicActive}
          slots={{ titlePrefix: draftPrefix }}
          titleColor={cssVar.colorText}
          icon={
            isLoading ? (
              <RingLoadingIcon
                ringColor={loadingRingColor}
                size={14}
                style={{ color: cssVar.colorWarning }}
              />
            ) : (
              <Icon color={cssVar.colorTextDescription} icon={MessageSquareDashed} size={'small'} />
            )
          }
          title={
            <Flexbox horizontal align={'center'} flex={1} gap={6}>
              {t('defaultTitle')}
              <Tag
                size={'small'}
                style={{
                  color: cssVar.colorTextDescription,
                  fontSize: 10,
                }}
              >
                {t('temp')}
              </Tag>
            </Flexbox>
          }
          onClick={handleClick}
        />
      );
    }

    // Execution / attention state. In workspace mode this moves to the row's
    // trailing side so the leading slot can carry the creator identity.
    const statusIconNode = (() => {
      // A scheduled topic hasn't run yet — nothing else can be true of it,
      // so its clock outranks the other states.
      if (isScheduled) {
        const visual = TOPIC_STATUS_VISUALS.scheduled;
        const runAt = metadata?.scheduledRun?.runAt;
        const icon = <Icon icon={visual.icon} size={'small'} style={{ color: visual.color }} />;
        return runAt ? (
          <Tooltip title={t('scheduledStatusTip', { time: dayjs(runAt).format('MM-DD HH:mm') })}>
            {icon}
          </Tooltip>
        ) : (
          icon
        );
      }
      if (isWaitingForHuman) {
        const visual = TOPIC_STATUS_VISUALS.waitingForHuman;
        return <Icon icon={visual.icon} size={'small'} style={{ color: visual.color }} />;
      }
      if (shouldShowRunningIcon) {
        return (
          <RingLoadingIcon
            ringColor={loadingRingColor}
            size={14}
            style={{ color: cssVar.colorWarning }}
          />
        );
      }
      if (isFailed) {
        const visual = TOPIC_STATUS_VISUALS.failed;
        return (
          <Tooltip title={t('failedStatusTip')}>
            <Icon icon={visual.icon} size={'small'} style={{ color: visual.color }} />
          </Tooltip>
        );
      }
      // Unread is the third `pending` attention state (see `resolveStatusBucket`
      // in `@lobechat/utils/client/topic`), so it ranks with its two siblings
      // above — and above the PR marker, which shares this single icon slot.
      if (hasUnread) return <UnreadDot />;
      // Persisted execution state is the topic's primary status. Keep every
      // non-idle state above git metadata so scheduled / completed
      // topics cannot be mistaken for merely open / merged / closed PRs.
      // `running` is handled exclusively by shouldShowRunningIcon above so
      // the masked post-output tail cannot fall back to a static running icon.
      if (status && status !== 'active' && status !== 'running') {
        const visual = TOPIC_STATUS_VISUALS[status];
        return <Icon icon={visual.icon} size={'small'} style={{ color: visual.color }} />;
      }
      return null;
    })();

    // Identity-flavored icons the row owns (bot platform, PR marker) — these
    // keep the leading slot even in workspace mode, with the creator shrunk to
    // a corner badge.
    const identityIconNode = (() => {
      // GitHub PR state marker (open=green, merged=purple, closed=red),
      // like Codex. It is secondary metadata, so only an idle topic uses it
      // as the leading icon.
      if (metaCard?.pullRequest) {
        const prVisual = PR_STATE_VISUAL[getPullRequestState(metaCard.pullRequest)];
        const ciStatus = metaCard.pullRequest.ciStatus;
        const ciVisual = getCiVisual(ciStatus);
        const showCiBadge = ciStatus !== undefined && ciStatus !== 'unknown';
        const tooltip = showCiBadge
          ? `${t(prVisual.labelKey)} · ${t(ciVisual.labelKey)}`
          : t(prVisual.labelKey);
        return (
          <Tooltip title={tooltip}>
            <span className={styles.prIcon}>
              <Icon icon={prVisual.icon} size={'small'} style={{ color: prVisual.color }} />
              {showCiBadge && (
                <span className={styles.ciBadge}>
                  <Icon
                    className={ciStatus === 'pending' ? styles.ciPending : undefined}
                    icon={ciVisual.icon}
                    size={9}
                    style={{ color: ciVisual.color }}
                  />
                </span>
              )}
            </span>
          </Tooltip>
        );
      }
      if (metadata?.bot?.platform) {
        const ProviderIcon = getPlatformIcon(metadata.bot!.platform);
        if (ProviderIcon) {
          return <ProviderIcon color={cssVar.colorTextDescription} size={16} />;
        }
      }
      return null;
    })();

    const idleIconPlaceholder = <span aria-hidden style={{ flex: 'none', width: 16 }} />;

    // Workspace mode (creator resolvable): the creator's round avatar is the
    // primary visual and always leads the row; the row's own icon — execution
    // status first, then identity icons (Discord / WeChat / PR marker) —
    // shrinks into a bottom-right corner badge. Personal mode keeps the
    // original layout untouched.
    const ownIconNode = statusIconNode ?? identityIconNode;
    const leadingIconNode = author ? (
      <TopicCreatorAvatar corner={ownIconNode} userId={userId} />
    ) : (
      (ownIconNode ?? idleIconPlaceholder)
    );

    const navItem = (
      <TopicItemContextMenu fav={fav} id={id} status={status} title={title}>
        <NavItem
          draggable
          actions={() => <Actions fav={fav} id={id} status={status} title={title} />}
          active={isTopicActive}
          description={workingDirectoryNode}
          href={href}
          icon={leadingIconNode}
          slots={{ titlePrefix: draftPrefix }}
          title={title === '...' ? <DotsLoading gap={3} size={4} /> : title}
          titleColor={cssVar.colorText}
          extra={
            <>
              <TopicMigrationIndicator agentId={activeAgentId} topicId={id} />
              <RunningElapsedTime agentId={activeAgentId} topicId={id} />
            </>
          }
          onClick={handleClick}
          onDoubleClick={() => void handleDoubleClick()}
          onDragStart={handleDragStart}
        />
      </TopicItemContextMenu>
    );

    return (
      <Flexbox data-testid="topic-item" data-topic-id={id} style={{ position: 'relative' }}>
        {metaCard ? (
          <Popover
            arrow={false}
            content={<MetaHoverCard metadata={metadata} title={title} topicId={id} />}
            mouseEnterDelay={0.8}
            placement={'right'}
            styles={META_HOVER_CARD_STYLES}
            trigger={'hover'}
          >
            <div>{navItem}</div>
          </Popover>
        ) : (
          navItem
        )}
        {showThreadList && (
          <Suspense
            fallback={
              <Flexbox gap={8} paddingBlock={8} paddingInline={24} width={'100%'}>
                <Skeleton height={18} width={'100%'} />
                <Skeleton height={18} width={'100%'} />
              </Flexbox>
            }
          >
            <ThreadList topicId={id} />
          </Suspense>
        )}
      </Flexbox>
    );
  },
);

TopicItemRow.displayName = 'TopicItemRow';

/**
 * Route awareness is resolved here rather than inside the row so that a
 * navigation re-renders only this thin shell. `useTopicNavigation` subscribes to
 * the pathname *and* to the chat store, so keeping it in the row made every
 * visible topic re-render its whole subtree twice per topic switch — with no
 * prop change to show for it. The row now takes plain booleans and bails out.
 *
 * The callbacks go through a ref because their identity changes on every
 * navigation; passing them as props would defeat the row's memo.
 */
const TopicItem = memo<TopicItemProps>((props) => {
  const { id } = props;
  const {
    focusTopicPopup,
    navigateToTopic,
    isInAgentSubRoute,
    isInTopicContextRoute,
    routeTopicId,
    urlTopicId,
  } = useTopicNavigation();

  // Active/thread state is subscribed here instead of arriving as props:
  // threading it through the group accordion re-rendered every group (and its
  // motion chain) on each topic switch, when only the two affected rows change.
  const active = useChatStore((s) => (id ? s.activeTopicId === id : !s.activeTopicId));
  const hasActiveThread = useChatStore((s) => !!s.activeThreadId);

  const navRef = useRef<TopicNavigationActions>({ focusTopicPopup, navigateToTopic });
  useEffect(() => {
    navRef.current = { focusTopicPopup, navigateToTopic };
  }, [focusTopicPopup, navigateToTopic]);

  const isRouteTopicActive = Boolean(id && routeTopicId === id && isInTopicContextRoute);

  return (
    <TopicItemRow
      {...props}
      defaultTopicActive={Boolean(active && !isInAgentSubRoute && !isInTopicContextRoute)}
      navRef={navRef}
      showThreadList={Boolean(id && id === urlTopicId)}
      isTopicActive={Boolean(
        (active || isRouteTopicActive) &&
        !hasActiveThread &&
        (!isInAgentSubRoute || isRouteTopicActive),
      )}
    />
  );
  // A list refresh rebuilds every topic/metadata object even when only one
  // topic changed — deep-compare props so unchanged rows still bail out.
}, isEqual);

TopicItem.displayName = 'TopicItem';

export default TopicItem;
