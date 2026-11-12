import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { ActionIcon, Spin } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PinIcon } from 'lucide-react';
import { type CSSProperties, type DragEvent, type RefObject } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import NavItem from '@/features/NavPanel/components/NavItem';
import {
  type BuildMenuItems,
  useLazyMenuItems,
  usePublishMenuItems,
} from '@/features/NavPanel/components/useLazyMenuItems';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import { useAgentModal } from '../../ModalProvider';
import Actions from '../Item/Actions';
import { usePreservedAgentUrl } from '../usePreservedAgentUrl';
import { useAgentDropdownMenu, type UseAgentDropdownMenuParams } from './useDropdownMenu';

const styles = stylex.create({
  badge: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockEnd: '-3px',
    insetInlineEnd: '-3px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '14px',
    height: '14px',
    paddingInline: '3px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '999px',
    fontSize: '9px',
    fontWeight: 600,
    lineHeight: 1,
    color: '#fff',
    backgroundColor: cssVar.colorError,
    backgroundImage: 'none',
  },
  runningBadge: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockEnd: '-3px',
    insetInlineEnd: '-3px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '999px',
    color: cssVar.colorWarning,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  wrapper: { position: 'relative', display: 'inline-flex' },
});

interface AgentItemProps {
  className?: string;
  item: SidebarAgentItem;
  onNavigate?: () => void;
  secondaryLabel?: string | null;
  style?: CSSProperties;
}

interface MenuHostProps extends UseAgentDropdownMenuParams {
  builderRef: RefObject<BuildMenuItems | undefined>;
}

const MenuHost = memo<MenuHostProps>(({ builderRef, ...params }) => {
  usePublishMenuItems(builderRef, useAgentDropdownMenu(params));
  return null;
});

MenuHost.displayName = 'AgentItemMenuHost';

/**
 * Keeps the row's workspace access record syncing from mount, as it did while
 * the menu hook was mounted eagerly, so a menu opened right after the first
 * hover already has its management items resolved.
 */
const AccessSync = memo<{ id: string }>(({ id }) => {
  useResourceAccess('agent', id);
  return null;
});

AccessSync.displayName = 'AgentItemAccessSync';

interface AgentItemBodyProps extends AgentItemProps {
  agentUrl: string;
}

const AgentItemBody = memo<AgentItemBodyProps>(
  ({ agentUrl, item, style, className, onNavigate, secondaryLabel }) => {
    const { id, avatar, backgroundColor, pinned, slug, userId, visibility } = item;
    // Unread count is server-computed (topics.status === 'unread') and carried on
    // the sidebar list item, so it stays accurate across agents whose topics
    // aren't loaded into the chat store on this client.
    const unreadCount = item.unreadCount ?? 0;
    const { t } = useTranslation('chat');
    const { openCreateGroupModal } = useAgentModal();
    const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

    const prefetchAgent = usePrefetchAgent();
    const isUpdating = useHomeStore((s) => s.agentUpdatingId === id);

    // Separate loading state from chat store - only show loading for this specific agent
    const isLoading = useChatStore(operationSelectors.isAgentVisiblyRunning(id));

    // Name-first label with fallback (see agentDisplayName)
    const displayTitle = agentDisplayName(item, t('untitledAgent'));
    // The role shown beside the name — same rule for every agent, heterogeneous
    // ones included (see agentSecondaryDisplayName).
    const roleTag = secondaryLabel || agentSecondaryDisplayName(item);

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
        return <Spin size="small" style={{ color: cssVar.colorTextDescription }} />;
      }

      const avatarNode = (
        <AgentAvatar
          agentId={id}
          avatar={typeof avatar === 'string' ? avatar : undefined}
          background={backgroundColor || undefined}
          name={displayTitle}
          size={22}
        />
      );

      if (isLoading) {
        return (
          <span {...stylex.props(styles.wrapper)}>
            {avatarNode}
            <span {...stylex.props(styles.runningBadge)}>
              <Spin size={9} style={{ color: 'inherit' }} />
            </span>
          </span>
        );
      }

      if (unreadCount > 0) {
        return (
          <span {...stylex.props(styles.wrapper)}>
            {avatarNode}
            <span {...stylex.props(styles.badge)}>{unreadCount > 99 ? '99+' : unreadCount}</span>
          </span>
        );
      }

      return avatarNode;
    }, [isUpdating, isLoading, id, avatar, backgroundColor, displayTitle, unreadCount]);

    const { arm, armed, builderRef, items: dropdownMenu } = useLazyMenuItems();
    const actions = useCallback(() => <Actions dropdownMenu={dropdownMenu} />, [dropdownMenu]);

    return (
      <>
        <AccessSync id={id} />
        {armed && (
          <MenuHost
            avatar={typeof avatar === 'string' ? avatar : undefined}
            backgroundColor={backgroundColor || undefined}
            builderRef={builderRef}
            group={undefined} // TODO: pass group from parent if needed
            id={id}
            name={item.name}
            openCreateGroupModal={handleOpenCreateGroupModal}
            pinned={pinned ?? false}
            slug={slug}
            title={displayTitle}
            userId={userId}
            visibility={visibility}
          />
        )}
        <WorkspaceLink
          aria-label={displayTitle}
          to={agentUrl}
          onClick={onNavigate}
          onMouseEnter={handleMouseEnter}
        >
          <NavItem
            actions={actions}
            className={className}
            contextMenuItems={dropdownMenu}
            disabled={isUpdating}
            draggable={!isUpdating}
            extra={pinIcon}
            icon={avatarIcon}
            key={id}
            style={style}
            title={
              roleTag ? (
                <>
                  {displayTitle}
                  <span style={{ fontSize: 12, marginInlineStart: 6, opacity: 0.6 }}>
                    {roleTag}
                  </span>
                </>
              ) : (
                displayTitle
              )
            }
            onDoubleClick={handleDoubleClick}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            onFocus={arm}
            onPointerEnter={arm}
          />
        </WorkspaceLink>
      </>
    );
  },
);

AgentItemBody.displayName = 'AgentItemBody';

/**
 * Sidebar agent row. Only this shell reads the location (for the preserved
 * sub-route), so a navigation that leaves the row's URL unchanged — such as a
 * topic switch — stops here instead of re-rendering the row. The row menu
 * mounts on first hover or focus (see `useLazyMenuItems`): its hook reaches
 * `useNavigate`, which re-renders on every navigation.
 */
const AgentItem = memo<AgentItemProps>((props) => {
  const agentUrl = usePreservedAgentUrl(props.item.id);
  return <AgentItemBody agentUrl={agentUrl} {...props} />;
});

AgentItem.displayName = 'AgentItem';

export default AgentItem;
