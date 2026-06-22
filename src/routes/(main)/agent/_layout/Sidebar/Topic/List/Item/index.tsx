import type { ChatTopicMetadata, ChatTopicStatus } from '@lobechat/types';
import { formatElapsedClockTime } from '@lobechat/utils';
import { Flexbox, Icon, Skeleton, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, keyframes, useTheme } from 'antd-style';
import { CheckCircle2, Hand, HashIcon, MessageSquareDashed, TriangleAlert } from 'lucide-react';
import { memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import DotsLoading from '@/components/DotsLoading';
import RingLoadingIcon from '@/components/RingLoading';
import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { isDesktop } from '@/const/version';
import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import { useHasDraft } from '@/features/ChatInput/draftStorage';
import NavItem from '@/features/NavPanel/components/NavItem';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
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
import Editing from './Editing';
import { useTopicItemDropdownMenu } from './useDropdownMenu';

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
  unreadWrapper: css`
    position: relative;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
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

// Last non-empty path segment — the folder name. Also yields the repo name for
// a web github URL (".../owner/repo" → "repo").
const getDirName = (path: string) => path.split('/').findLast(Boolean) || path;

interface RunningElapsedTimeProps {
  agentId?: string;
  topicId: string;
}

const RunningElapsedTime = memo<RunningElapsedTimeProps>(({ agentId, topicId }) => {
  const startTime = useChatStore(
    agentId
      ? operationSelectors.getAgentRuntimeStartTimeByContext({ agentId, topicId })
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
  active?: boolean;
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
  threadId?: string;
  title: string;
}

const TopicItem = memo<TopicItemProps>(
  ({ id, title, fav, active, threadId, metadata, status, showWorkingDirectory }) => {
    const { t } = useTranslation('topic');
    const { isDarkMode } = useTheme();
    const activeAgentId = useAgentStore((s) => s.activeAgentId);
    const activeWorkspaceSlug = useActiveWorkspaceSlug();
    // Heterogeneous agents (Claude Code, Codex, …) don't have the chat-style
    // topic semantics, so skip the default `#` placeholder icon for their rows.
    const isHeterogeneousAgent = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
    const addTab = useElectronStore((s) => s.addTab);

    const loadingRingColor = isDarkMode
      ? cssVar.colorWarningBorder
      : `color-mix(in srgb, ${cssVar.colorWarning} 45%, transparent)`;

    // Construct href for cmd+click support
    const href = useMemo(() => {
      if (!activeAgentId || !id) return undefined;
      return buildWorkspaceAwarePath(
        SESSION_CHAT_TOPIC_URL(activeAgentId, id),
        activeWorkspaceSlug,
      );
    }, [activeAgentId, activeWorkspaceSlug, id]);

    const [editing, isLoading] = useChatStore((s) => [
      id ? s.topicRenamingId === id : false,
      id ? s.topicLoadingIds.includes(id) : false,
    ]);

    const isUnreadCompleted = useChatStore(
      id ? operationSelectors.isTopicUnreadCompleted(id) : () => false,
    );

    const {
      focusTopicPopup,
      navigateToTopic,
      isInAgentSubRoute,
      isInTopicContextRoute,
      routeTopicId,
      urlTopicId,
    } = useTopicNavigation();
    const isRouteTopicActive = Boolean(id && routeTopicId === id && isInTopicContextRoute);
    const isTopicActive = Boolean(
      (active || isRouteTopicActive) && !threadId && (!isInAgentSubRoute || isRouteTopicActive),
    );

    const shouldShowThreadList = Boolean(id && id === urlTopicId);

    const toggleEditing = useCallback(
      (visible?: boolean) => {
        useChatStore.setState({ topicRenamingId: visible && id ? id : '' });
      },
      [id],
    );

    const handleClick = useCallback(() => {
      if (editing) return;
      if (isDesktop) {
        cancelPendingSingleClick();
        pendingSingleClickTimer = setTimeout(() => {
          pendingSingleClickTimer = null;
          void navigateToTopic(id);
        }, 250);
      } else {
        void navigateToTopic(id);
      }
    }, [editing, id, navigateToTopic]);

    const handleDoubleClick = useCallback(async () => {
      if (!id || !activeAgentId || !isDesktop) return;
      cancelPendingSingleClick();
      if (await focusTopicPopup(id)) {
        void navigateToTopic(id, { skipPopupFocus: true });
        return;
      }
      addTab(SESSION_CHAT_TOPIC_URL(activeAgentId, id));
      void navigateToTopic(id);
    }, [id, activeAgentId, addTab, focusTopicPopup, navigateToTopic]);

    const { dropdownMenu } = useTopicItemDropdownMenu({
      fav,
      id,
      status,
      title,
    });

    const isCompleted = status === 'completed';
    const isFailed = status === 'failed';
    const isRunning = status === 'running';
    const isWaitingForHuman = status === 'waitingForHuman';

    // By-status grouping mixes topics from different projects, so surface each
    // topic's working directory as a muted second line. Data is already on the
    // topic (`metadata.workingDirectory`) — no fetch. On web it's a github repo
    // URL; on desktop a local path shown with a plain folder icon.
    const workingDirectory = metadata?.workingDirectory;
    const workingDirectoryNode =
      showWorkingDirectory && workingDirectory ? (
        <Flexbox horizontal align={'center'} gap={4} style={{ overflow: 'hidden' }}>
          <DirIcon repoType={isDesktop ? undefined : 'github'} size={12} />
          <Text ellipsis fontSize={11} style={{ color: cssVar.colorTextDescription }}>
            {getDirName(workingDirectory)}
          </Text>
        </Flexbox>
      ) : undefined;

    const hasUnread = id && isUnreadCompleted;
    const unreadIcon = (
      <span className={styles.unreadWrapper}>
        <span className={styles.unreadRipple} />
        <span className={styles.unreadDot} />
      </span>
    );

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

    // For default topic (no id)
    if (!id) {
      return (
        <NavItem
          active={Boolean(active && !isInAgentSubRoute && !isInTopicContextRoute)}
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

    return (
      <Flexbox data-testid="topic-item" style={{ position: 'relative' }}>
        <NavItem
          actions={<Actions dropdownMenu={dropdownMenu} />}
          active={isTopicActive}
          contextMenuItems={dropdownMenu}
          description={workingDirectoryNode}
          disabled={editing}
          extra={<RunningElapsedTime agentId={activeAgentId} topicId={id} />}
          href={href}
          slots={{ titlePrefix: draftPrefix }}
          title={title === '...' ? <DotsLoading gap={3} size={4} /> : title}
          titleColor={cssVar.colorText}
          icon={(() => {
            if (isWaitingForHuman) {
              return <Icon icon={Hand} size={'small'} style={{ color: cssVar.colorInfo }} />;
            }
            if (isLoading || isRunning) {
              return (
                <RingLoadingIcon
                  ringColor={loadingRingColor}
                  size={14}
                  style={{ color: cssVar.colorWarning }}
                />
              );
            }
            if (isFailed) {
              return (
                <Tooltip title={t('failedStatusTip')}>
                  <Icon icon={TriangleAlert} size={'small'} style={{ color: cssVar.colorError }} />
                </Tooltip>
              );
            }
            if (isCompleted) {
              return (
                <Icon
                  icon={CheckCircle2}
                  size={'small'}
                  style={{ color: cssVar.colorTextDescription }}
                />
              );
            }
            if (hasUnread) return unreadIcon;
            if (metadata?.bot?.platform) {
              const ProviderIcon = getPlatformIcon(metadata.bot!.platform);
              if (ProviderIcon) {
                return <ProviderIcon color={cssVar.colorTextDescription} size={16} />;
              }
            }
            return (
              <Icon
                icon={HashIcon}
                size={'small'}
                style={{
                  color: cssVar.colorTextDescription,
                  // Heterogeneous agents (Claude Code, Codex, …) have no chat-style
                  // topic semantics, so suppress the `#` glyph while keeping its
                  // box so the title stays aligned with sibling rows.
                  visibility: isHeterogeneousAgent ? 'hidden' : undefined,
                }}
              />
            );
          })()}
          onClick={handleClick}
          onDoubleClick={() => void handleDoubleClick()}
        />
        <Editing id={id} title={title} toggleEditing={toggleEditing} />
        {shouldShowThreadList && (
          <Suspense
            fallback={
              <Flexbox gap={8} paddingBlock={8} paddingInline={24} width={'100%'}>
                <Skeleton.Button active size={'small'} style={{ height: 18, width: '100%' }} />
                <Skeleton.Button active size={'small'} style={{ height: 18, width: '100%' }} />
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

export default TopicItem;
