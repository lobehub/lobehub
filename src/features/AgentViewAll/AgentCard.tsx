'use client';

import { AGENT_CHAT_URL, DEFAULT_USER_AVATAR_URL, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import {
  Avatar,
  Block,
  ContextMenuTrigger,
  createStaticStyles,
  cx,
  type DropdownItem,
  Text,
} from '@lobehub/ui';
import { type CSSProperties, memo, type ReactNode, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import AgentPendant from './AgentPendant';
import type { AgentRowAuthor } from './AgentRow';
import ItemActions from './ItemActions';
import { resolveAgentBadge } from './resolveAgentBadge';
import SidebarItemAvatar from './SidebarItemAvatar';
import { useAgentCoverColor } from './useAgentCoverColor';

// Badge-wall layout: cover → avatar → name → role chip → two-line description,
// centered, with the owner in the bottom-left corner. Every row has a fixed
// height, so the avatar, the name baseline and the description's first line
// line up across a row. The avatar straddles the cover's bottom edge.
const COVER_HEIGHT = 80;
const AVATAR_SIZE = 56;
export const AGENT_GRID_MIN_COLUMN = 260;

export const cardStyles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    position: relative;

    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;

    padding-block: ${COVER_HEIGHT - AVATAR_SIZE / 2}px 16px;
    padding-inline: 12px;

    text-align: center;

    transition:
      transform 0.18s,
      box-shadow 0.18s,
      border-color 0.18s;

    &:hover {
      transform: translateY(-1px);
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  // Identity texture, not artwork: a straight-edged band tinted from the
  // agent's avatar (see useAgentCoverColor), mixed toward the container color
  // so it stays calm in both themes, with a faint dot grid on top.
  cover: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline: 0;

    height: ${COVER_HEIGHT}px;

    /* Neutral until an avatar image has been sampled. */
    background-color: color-mix(
      in srgb,
      var(--agent-cover, ${cssVar.colorFill}) 72%,
      ${cssVar.colorBgContainer}
    );
    background-image: radial-gradient(
      color-mix(in srgb, ${cssVar.colorBgContainer} 30%, transparent) 1px,
      transparent 1.5px
    );
    background-size: 10px 10px;

    /* The sampled color fades in over the neutral band. */
    transition: background-color 0.3s;
  `,
  avatarRing: css`
    position: relative;

    overflow: hidden;
    display: inline-flex;

    border: 3px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    /* Neutral face plate for emoji avatars without a background color;
       images and colored avatars paint over it. */
    background: ${cssVar.colorFillTertiary};
    background-clip: padding-box;
  `,
  // Group avatars are a square member grid; a circle would clip its corners.
  avatarRingGroup: css`
    border-radius: ${cssVar.borderRadiusLG};
  `,
  // Colored avatars already shrink their emoji (emojiScaleWithBackground);
  // plain ones would fill the whole circle, so give them the same breathing room.
  avatarPlain: css`
    & img.lobe-fluent-emoji {
      transform: scale(0.72);
    }
  `,
  name: css`
    width: 100%;
    margin-block-start: 8px;

    font-size: 14px;
    font-weight: 600;
    line-height: 22px;
  `,
  roleRow: css`
    display: flex;
    justify-content: center;

    width: 100%;
    height: 22px;
    margin-block-start: 4px;
  `,
  role: css`
    overflow: hidden;

    max-width: 100%;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    width: 100%;
    height: 36px;
    margin-block-start: 8px;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  // Pinned to the bottom-left corner: auto top margin takes up whatever height
  // the grid row adds, so the owner sits on the same line across a row.
  owner: css`
    display: flex;
    gap: 6px;
    align-items: center;
    align-self: stretch;

    min-width: 0;
    margin-block-start: auto;
    padding-block-start: 12px;

    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
  ownerName: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  // Columns come from the content width: as many 260px+ badges as fit, so a
  // ~1300px page shows four and an ultra-wide one six, instead of a fixed four
  // stretching each badge. Shares the min width with SidebarAgentsSection so
  // the two grids line up.
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(${AGENT_GRID_MIN_COLUMN}px, 100%), 1fr));
    gap: 12px;

    width: 100%;
    min-width: 0;
  `,
  /* Top-right "…" slot, a SIBLING of the card link (absolutely positioned
     over it) — nesting an interactive menu trigger inside the <a> would put
     a button inside a link in the accessibility tree. It fades in on hover /
     focus so the wall stays clean, and is always shown on touch screens. */
  actions: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    border-radius: ${cssVar.borderRadiusSM};

    opacity: 0;
    background: color-mix(in srgb, ${cssVar.colorBgContainer} 85%, transparent);

    transition: opacity 0.15s;

    @media (hover: none) {
      opacity: 1;
    }
  `,
  link: css`
    display: block;
    min-width: 0;
    height: 100%;
    color: inherit;
  `,
  wrapper: css`
    position: relative;
    min-width: 0;
    height: 100%;

    &:hover > [data-card-actions],
    &:focus-within > [data-card-actions] {
      opacity: 1;
    }
  `,
}));

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
  const coverColor = useAgentCoverColor(item, badge.cover);
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
              style={{ '--agent-cover': coverColor } as CSSProperties}
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
