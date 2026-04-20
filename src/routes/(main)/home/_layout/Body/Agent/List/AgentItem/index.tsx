import { SESSION_CHAT_URL } from '@lobechat/const';
import { type SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2, PinIcon } from 'lucide-react';
import { type CSSProperties, type DragEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { prefetchRoute } from '@/utils/router';

import { useAgentModal } from '../../ModalProvider';
import Actions from '../Item/Actions';
import Avatar from './Avatar';
import { useAgentDropdownMenu } from './useDropdownMenu';

const HETEROGENEOUS_TYPE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: -3px;
    inset-inline-end: -3px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    min-width: 14px;
    height: 14px;
    padding-inline: 3px;
    border: 1.5px solid ${cssVar.colorBgContainer};
    border-radius: 999px;

    font-size: 9px;
    font-weight: 600;
    line-height: 1;
    color: #fff;

    background: ${cssVar.colorError};
  `,
  runningBadge: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: -3px;
    inset-inline-end: -3px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
    border: 1.5px solid ${cssVar.colorBgContainer};
    border-radius: 999px;

    color: ${cssVar.colorWarning};

    background: ${cssVar.colorBgContainer};
  `,
  wrapper: css`
    position: relative;
    display: inline-flex;
  `,
}));

interface AgentItemProps {
  className?: string;
  item: SidebarAgentItem;
  style?: CSSProperties;
}

const AgentItem = memo<AgentItemProps>(({ item, style, className }) => {
  const { id, avatar, backgroundColor, title, pinned, heterogeneousType } = item;
  const { t } = useTranslation('chat');
  const { openCreateGroupModal } = useAgentModal();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  const prefetchAgent = usePrefetchAgent();
  const isUpdating = useHomeStore((s) => s.agentUpdatingId === id);

  // Separate loading state from chat store - only show loading for this specific agent
  const isLoading = useChatStore(operationSelectors.isAgentRunning(id));
  const unreadCount = useChatStore(operationSelectors.agentUnreadCount(id));

  // Get display title with fallback
  const displayTitle = title || t('untitledAgent');

  // Heterogeneous agents (Claude Code, Codex, …) show their runtime as a tag
  // so they stand out from built-in agents in the sidebar.
  const heterogeneousLabel = heterogeneousType
    ? (HETEROGENEOUS_TYPE_LABELS[heterogeneousType] ?? heterogeneousType)
    : null;

  const titleNode = heterogeneousLabel ? (
    <Flexbox horizontal align="center" gap={4}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayTitle}
      </span>
      <Tag size="small" style={{ flexShrink: 0 }}>
        {heterogeneousLabel}
      </Tag>
    </Flexbox>
  ) : (
    displayTitle
  );

  // Get URL for this agent
  const agentUrl = SESSION_CHAT_URL(id, false);

  // Memoize event handlers
  const handleMouseEnter = useCallback(() => {
    prefetchAgent(id);
    prefetchRoute(agentUrl);
  }, [id, prefetchAgent, agentUrl]);

  const handleDoubleClick = useCallback(() => {
    openAgentInNewWindow(id);
  }, [id, openAgentInNewWindow]);

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', id);
    },
    [id],
  );

  const handleDragEnd = useCallback(
    (e: DragEvent) => {
      if (e.dataTransfer.dropEffect === 'none') {
        openAgentInNewWindow(id);
      }
    },
    [id, openAgentInNewWindow],
  );

  const handleOpenCreateGroupModal = useCallback(() => {
    openCreateGroupModal(id);
  }, [id, openCreateGroupModal]);

  // Memoize pin icon
  const pinIcon = useMemo(
    () =>
      pinned ? (
        <ActionIcon icon={PinIcon} size={12} style={{ opacity: 0.5, pointerEvents: 'none' }} />
      ) : undefined,
    [pinned],
  );

  // Memoize avatar icon (show loader when updating, running spinner or unread badge at bottom-right)
  const avatarIcon = useMemo(() => {
    if (isUpdating) {
      return <Icon spin color={cssVar.colorTextDescription} icon={Loader2} size={18} />;
    }

    const avatarNode = (
      <Avatar
        avatar={typeof avatar === 'string' ? avatar : undefined}
        avatarBackground={backgroundColor || undefined}
      />
    );

    if (isLoading) {
      return (
        <span className={styles.wrapper}>
          {avatarNode}
          <span className={styles.runningBadge}>
            <Icon spin icon={Loader2} size={9} />
          </span>
        </span>
      );
    }

    if (unreadCount > 0) {
      return (
        <span className={styles.wrapper}>
          {avatarNode}
          <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        </span>
      );
    }

    return avatarNode;
  }, [isUpdating, isLoading, avatar, backgroundColor, unreadCount]);

  const dropdownMenu = useAgentDropdownMenu({
    anchor,
    avatar: typeof avatar === 'string' ? avatar : undefined,
    group: undefined, // TODO: pass group from parent if needed
    id,
    openCreateGroupModal: handleOpenCreateGroupModal,
    pinned: pinned ?? false,
    title: displayTitle,
  });

  return (
    <Link aria-label={displayTitle} ref={setAnchor} to={agentUrl} onMouseEnter={handleMouseEnter}>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        className={className}
        contextMenuItems={dropdownMenu}
        disabled={isUpdating}
        draggable={!isUpdating}
        extra={pinIcon}
        icon={avatarIcon}
        key={id}
        style={style}
        title={titleNode}
        onDoubleClick={handleDoubleClick}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
      />
    </Link>
  );
});

export default AgentItem;
