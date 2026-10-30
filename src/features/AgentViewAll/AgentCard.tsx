'use client';

import { AGENT_CHAT_URL, DEFAULT_USER_AVATAR_URL, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Avatar, Block, ContextMenuTrigger, cx, type DropdownItem, Text } from '@lobehub/ui';
import { type CSSProperties, memo, type ReactNode, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import cardStyles from './AgentCard.module.css';
import AgentPendant from './AgentPendant';
import type { AgentRowAuthor } from './AgentRow';
import { coverPattern } from './coverColor';
import ItemActions from './ItemActions';
import { resolveAgentBadge } from './resolveAgentBadge';
import SidebarItemAvatar from './SidebarItemAvatar';
import { useAgentCoverColor } from './useAgentCoverColor';

// Badge-wall layout: cover → avatar → name → role chip → two-line description,
// centered, with the owner in the bottom-left corner. Every row has a fixed
// height, so the avatar, the name baseline and the description's first line
// line up across a row. The avatar straddles the cover's bottom edge.
// The cover is 80px tall; its selector-based rules live in AgentCard.module.css.
const AVATAR_SIZE = 56;
export const AGENT_GRID_MIN_COLUMN = 260;
export { default as cardStyles } from './AgentCard.module.css';

/** Badge-wall grid wrapper. */
export const AgentCardGrid = memo<{ children: ReactNode }>(({ children }) => (
  <div className={cardStyles.grid}>{children}</div>
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
      <div className={cardStyles.wrapper}>
        <WorkspaceLink
          aria-label={displayTitle}
          className={cardStyles.link}
          ref={setAnchor}
          to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
          onPointerEnter={activateMenu}
        >
          <Block clickable className={cardStyles.card} height={'100%'} variant={'outlined'}>
            <div
              className={cardStyles.cover}
              data-cover-image={badge.coverImage ? '' : undefined}
              data-pattern={badge.coverImage ? undefined : coverPattern(item)}
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
                className={cx(
                  cardStyles.avatarRing,
                  !badge.cover && cardStyles.avatarPlain,
                  type === 'group' && cardStyles.avatarRingGroup,
                )}
              >
                <SidebarItemAvatar item={item} shape={'circle'} size={AVATAR_SIZE - 6} />
              </span>
            </AgentPendant>
            <Text ellipsis className={cardStyles.name}>
              {displayTitle}
            </Text>
            <div className={cardStyles.roleRow}>
              {roleTag ? (
                <span className={cardStyles.role} title={roleTag}>
                  {roleTag}
                </span>
              ) : null}
            </div>
            <div className={cardStyles.description}>{description}</div>
            {owner?.name ? (
              <div className={cardStyles.owner}>
                <Avatar
                  avatar={owner.avatar || DEFAULT_USER_AVATAR_URL}
                  shape={'circle'}
                  size={16}
                />
                <span className={cardStyles.ownerName} title={owner.name}>
                  {owner.name}
                </span>
              </div>
            ) : null}
          </Block>
        </WorkspaceLink>
        <span data-card-actions className={cardStyles.actions}>
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
