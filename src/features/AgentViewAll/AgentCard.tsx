'use client';

import './AgentCard.css';

import { AGENT_CHAT_URL, DEFAULT_USER_AVATAR_URL, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Avatar, Block, ContextMenuTrigger, cx, type DropdownItem, Text } from '@lobehub/ui';
import { type CSSProperties, memo, type ReactNode, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

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
// The cover is 80px tall; its selector-based rules live in AgentCard.css.
const AVATAR_SIZE = 56;
export const AGENT_GRID_MIN_COLUMN = 260;
export const cardStyles = {
  card: 'lobe-agent-card-2f4e89d4-card',
  cover: 'lobe-agent-card-2f4e89d4-cover',
  avatarRing: 'lobe-agent-card-2f4e89d4-avatar-ring',
  avatarRingGroup: 'lobe-agent-card-2f4e89d4-avatar-ring-group',
  avatarPlain: 'lobe-agent-card-2f4e89d4-avatar-plain',
  name: 'lobe-agent-card-2f4e89d4-name',
  roleRow: 'lobe-agent-card-2f4e89d4-role-row',
  role: 'lobe-agent-card-2f4e89d4-role',
  description: 'lobe-agent-card-2f4e89d4-description',
  owner: 'lobe-agent-card-2f4e89d4-owner',
  ownerName: 'lobe-agent-card-2f4e89d4-owner-name',
  grid: 'lobe-agent-card-2f4e89d4-grid',
  actions: 'lobe-agent-card-2f4e89d4-actions',
  link: 'lobe-agent-card-2f4e89d4-link',
  wrapper: 'lobe-agent-card-2f4e89d4-wrapper',
} as const;

/** Badge-wall grid wrapper. */
export const AgentCardGrid = memo<{ children: ReactNode }>(({ children }) => (
  <div className={'lobe-agent-card-2f4e89d4-grid'}>{children}</div>
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
      <div className={'lobe-agent-card-2f4e89d4-wrapper'}>
        <WorkspaceLink
          aria-label={displayTitle}
          className={'lobe-agent-card-2f4e89d4-link'}
          ref={setAnchor}
          to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
          onPointerEnter={activateMenu}
        >
          <Block
            clickable
            className={'lobe-agent-card-2f4e89d4-card'}
            height={'100%'}
            variant={'outlined'}
          >
            <div
              className={'lobe-agent-card-2f4e89d4-cover'}
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
                  'lobe-agent-card-2f4e89d4-avatar-ring',
                  !badge.cover && 'lobe-agent-card-2f4e89d4-avatar-plain',
                  type === 'group' && 'lobe-agent-card-2f4e89d4-avatar-ring-group',
                )}
              >
                <SidebarItemAvatar item={item} shape={'circle'} size={AVATAR_SIZE - 6} />
              </span>
            </AgentPendant>
            <Text ellipsis className={'lobe-agent-card-2f4e89d4-name'}>
              {displayTitle}
            </Text>
            <div className={'lobe-agent-card-2f4e89d4-role-row'}>
              {roleTag ? (
                <span className={'lobe-agent-card-2f4e89d4-role'} title={roleTag}>
                  {roleTag}
                </span>
              ) : null}
            </div>
            <div className={'lobe-agent-card-2f4e89d4-description'}>{description}</div>
            {owner?.name ? (
              <div className={'lobe-agent-card-2f4e89d4-owner'}>
                <Avatar
                  avatar={owner.avatar || DEFAULT_USER_AVATAR_URL}
                  shape={'circle'}
                  size={16}
                />
                <span className={'lobe-agent-card-2f4e89d4-owner-name'} title={owner.name}>
                  {owner.name}
                </span>
              </div>
            ) : null}
          </Block>
        </WorkspaceLink>
        <span data-card-actions className={'lobe-agent-card-2f4e89d4-actions'}>
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
