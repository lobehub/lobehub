import { type SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2, PinIcon } from 'lucide-react';
import { type CSSProperties, type DragEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import { useAgentModal } from '../../ModalProvider';
import Actions from '../Item/Actions';
import { usePreservedAgentUrl } from '../usePreservedAgentUrl';
import Avatar from './Avatar';
import { useAgentDropdownMenu } from './useDropdownMenu';

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
  onNavigate?: () => void;
  style?: CSSProperties;
}

const AgentItem = memo<AgentItemProps>(({ item, style, className, onNavigate }) => {
  const { id, avatar, backgroundColor, title, pinned, slug, userId, visibility } = item;
  // Unread count is server-computed (topics.status === 'unread') and carried on
  // the sidebar list item, so it stays accurate across agents whose topics
  // aren't loaded into the chat store on this client.
  const unreadCount = item.unreadCount ?? 0;
  const { t } = useTranslation('chat');
  const { openCreateGroupModal } = useAgentModal();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  const prefetchAgent = usePrefetchAgent();
  const isUpdating = useHomeStore((s) => s.agentUpdatingId === id);

  // Separate loading state from chat store - only show loading for this specific agent
  const isLoading = useChatStore(operationSelectors.isAgentVisiblyRunning(id));

  // Get display title with fallback
  const displayTitle = title || t('untitledAgent');

  const agentUrl = usePreservedAgentUrl(id);

  // Memoize event handlers
  const handleMouseEnter = useCallback(() => {
    prefetchAgent(id);
  }, [id, prefetchAgent]);

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
    openCreateGroupModal(id, visibility);
  }, [id, openCreateGroupModal, visibility]);

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
    backgroundColor: backgroundColor || undefined,
    group: undefined, // TODO: pass group from parent if needed
    id,
    openCreateGroupModal: handleOpenCreateGroupModal,
    pinned: pinned ?? false,
    slug,
    title: displayTitle,
    userId,
    visibility,
  });

  return (
    <WorkspaceLink
      aria-label={displayTitle}
      ref={setAnchor}
      to={agentUrl}
      onClick={onNavigate}
      onMouseEnter={handleMouseEnter}
    >
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
        title={displayTitle}
        onDoubleClick={handleDoubleClick}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
      />
    </WorkspaceLink>
  );
});

export default AgentItem;
