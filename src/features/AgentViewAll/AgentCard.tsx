'use client';

// oxlint-disable-next-line stylex-migration/no-plain-css -- needs lobe-ui slot: Avatar.emoji (the FluentEmoji img inside Avatar's content span takes no className)
import './AgentCard.css';

import { AGENT_CHAT_URL, DEFAULT_USER_AVATAR_URL, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Avatar, Block, ContextMenuTrigger, type DropdownItem, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, memo, type ReactNode, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { sx } from '@/styles/sx';

import { cardStyles, coverStyles } from './agentCardStyles';
import AgentPendant from './AgentPendant';
import type { AgentRowAuthor } from './AgentRow';
import { coverPattern } from './coverColor';
import ItemActions from './ItemActions';
import { cardMarker } from './markers.stylex';
import { resolveAgentBadge } from './resolveAgentBadge';
import SidebarItemAvatar from './SidebarItemAvatar';
import { useAgentCoverColor } from './useAgentCoverColor';

// Badge-wall layout: cover → avatar → name → role chip → two-line description,
// centered, with the owner in the bottom-left corner. Every row has a fixed
// height, so the avatar, the name baseline and the description's first line
// line up across a row. The avatar straddles the cover's bottom edge.
const AVATAR_SIZE = 56;
export const AGENT_GRID_MIN_COLUMN = 260;
const AVATAR_PLAIN_CLASSNAME = 'lobe-agent-card-2f4e89d4-avatar-plain';

export const AgentCardGrid = memo<{ children: ReactNode }>(({ children }) => (
  <div {...stylex.props(cardStyles.grid)}>{children}</div>
));

AgentCardGrid.displayName = 'AgentCardGrid';

interface AgentCardProps {
  item: SidebarAgentItem;
  /** Toggle whether this item appears in the caller's sidebar. */
  onToggleSidebar?: (item: SidebarAgentItem) => void;
  /** Who owns the agent; shown in the bottom-left corner when given. */
  owner?: AgentRowAuthor | null;
  /** Whether the caller removed this item from their sidebar (default listed). */
  sidebarHidden?: boolean;
}

const AgentCard = memo<AgentCardProps>(({ item, onToggleSidebar, owner, sidebarHidden }) => {
  const { t } = useTranslation('common');
  const { description, id, type } = item;
  // Groups have no personal name, so this resolves to their title.
  const displayTitle = agentDisplayName(item, t('agentViewAll.untitled'));
  const roleTag = agentSecondaryDisplayName(item);
  const badge = resolveAgentBadge(item);
  const coverColor = useAgentCoverColor(item, badge.cover, !!badge.coverImage);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // Right-click support — same bridge as AgentRow: the hook-bearing menu
  // mounts on the card's pointer-enter and hands its items back via ref.
  const [menuActivated, setMenuActivated] = useState(false);
  const activateMenu = useCallback(() => setMenuActivated(true), []);
  const menuItemsRef = useRef<(() => DropdownItem[]) | null>(null);
  const handleMenuReady = useCallback((getItems: () => DropdownItem[]) => {
    menuItemsRef.current = getItems;
  }, []);
  const getContextMenuItems = useCallback(() => menuItemsRef.current?.() ?? [], []);

  return (
    <ContextMenuTrigger items={getContextMenuItems}>
      <div {...stylex.props(cardMarker, cardStyles.wrapper)}>
        <WorkspaceLink
          aria-label={displayTitle}
          className={stylex.props(cardStyles.link).className}
          ref={setAnchor}
          to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
          onPointerEnter={activateMenu}
        >
          <Block
            clickable
            className={stylex.props(cardStyles.card).className}
            height={'100%'}
            variant={'outlined'}
          >
            <div
              data-cover-image={badge.coverImage ? '' : undefined}
              data-pattern={badge.coverImage ? undefined : coverPattern(item)}
              className={
                stylex.props(
                  coverStyles.root,
                  badge.coverImage ? coverStyles.coverImage : coverStyles[coverPattern(item)],
                ).className
              }
              style={
                {
                  '--agent-cover': coverColor,
                  'backgroundImage': badge.coverImage
                    ? `url(${JSON.stringify(badge.coverImage)})`
                    : undefined,
                } as CSSProperties
              }
            />
            <AgentPendant bottom={badge.bottom} top={badge.top}>
              <span
                {...sx(
                  [cardStyles.avatarRing, type === 'group' && cardStyles.avatarRingGroup],
                  badge.cover ? undefined : AVATAR_PLAIN_CLASSNAME,
                )}
              >
                <SidebarItemAvatar item={item} shape={'circle'} size={AVATAR_SIZE - 6} />
              </span>
            </AgentPendant>
            <Text ellipsis className={stylex.props(cardStyles.name).className}>
              {displayTitle}
            </Text>
            <div {...stylex.props(cardStyles.roleRow)}>
              {roleTag ? (
                <span {...stylex.props(cardStyles.role)} title={roleTag}>
                  {roleTag}
                </span>
              ) : null}
            </div>
            <div {...stylex.props(cardStyles.description)}>{description}</div>
            {owner?.name ? (
              <div {...stylex.props(cardStyles.owner)}>
                <Avatar
                  avatar={owner.avatar || DEFAULT_USER_AVATAR_URL}
                  shape={'circle'}
                  size={16}
                />
                <span {...stylex.props(cardStyles.ownerName)} title={owner.name}>
                  {owner.name}
                </span>
              </div>
            ) : null}
          </Block>
        </WorkspaceLink>
        <span data-card-actions {...stylex.props(cardStyles.actions)}>
          {/* Visible "…" trigger AND right-click open the same menu — the
              context menu alone proved undiscoverable (the sidebar toggle
              folds into it via includeSidebarToggle). Rendered as a SIBLING
              of the link (not inside it) so the menu button isn't a nested
              interactive control within the card's <a>. */}
          <ItemActions
            includeSidebarToggle
            anchor={anchor}
            forceActivated={menuActivated}
            item={item}
            sidebarHidden={sidebarHidden}
            onMenuReady={handleMenuReady}
            onToggleSidebar={onToggleSidebar}
          />
        </span>
      </div>
    </ContextMenuTrigger>
  );
});

AgentCard.displayName = 'AgentCard';

export default AgentCard;
