'use client';

import { AGENT_CHAT_URL, DEFAULT_AVATAR, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  ContextMenuTrigger,
  Flexbox,
  type MenuProps,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import AgentAvatar from './AgentAvatar';
import ItemActions from './ItemActions';
import LabelTags from './LabelTags';

/** Fixed action-column width (sidebar-eye toggle only) so rows stay aligned. */
export const ACTION_COL_WIDTH = 40;

/** Author avatar slot — reserved even when the author is unknown. */
const AUTHOR_COL_WIDTH = 20;

const styles = createStaticStyles(({ css, cssVar }) => ({
  // The link spans the name column (not the whole row) — a management list
  // is for scanning and acting, and a full-row link turns clicks on the
  // author / timestamp / action columns into a navigation. The name column
  // stays a generous target, including the space right of a short title.
  identity: css`
    cursor: pointer;

    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;

    min-width: 0;

    color: inherit;

    &:hover .agent-row-title {
      text-decoration: underline;
    }
  `,
  row: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    color: inherit;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  /**
   * Reserved width, right-aligned: "3 天前" and "2026-07-22" differ by ~30px,
   * and a content-sized column puts the author avatar and the label pills at a
   * different x on every row. `min-width` (not `width`) so an unusually long
   * relative string — en's "a few seconds ago" — grows instead of truncating.
   */
  updatedAt: css`
    flex: none;

    min-width: 88px;

    color: ${cssVar.colorTextQuaternary};
    text-align: end;
    white-space: nowrap;
  `,
}));

/** < 7 days → relative time; older → plain date (mirrors TopicSelector). */
export const formatUpdatedAt = (updatedAt: Date | number | string) =>
  dayjs().diff(dayjs(updatedAt), 'd') < 7
    ? dayjs(updatedAt).fromNow()
    : dayjs(updatedAt).format('YYYY-MM-DD');

export interface AgentRowAuthor {
  avatar?: string | null;
  name?: string | null;
}

interface AgentRowProps {
  /** Creator profile; rendered only when `showAuthor` is set. */
  author?: AgentRowAuthor | null;
  item: SidebarAgentItem;
  /**
   * Toggle whether this item appears in the caller's sidebar. A membership
   * action, deliberately distinct from the sidebar's own 置顶 pin
   * (`agents.pinned`) — that stays untouched.
   */
  onToggleSidebar?: (item: SidebarAgentItem) => void;
  /** Whether to render the author column (workspace mode). */
  showAuthor?: boolean;
  /** Whether the caller removed this item from their sidebar (default listed). */
  sidebarHidden?: boolean;
}

const AgentRow = memo<AgentRowProps>(
  ({ author, item, onToggleSidebar, showAuthor, sidebarHidden }) => {
    const { t } = useTranslation('common');
    const { id, type, updatedAt } = item;
    // Groups have no personal name, so this resolves to their title.
    const displayTitle = agentDisplayName(item, t('agentViewAll.untitled'));
    const roleTag = agentSecondaryDisplayName(item);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    // Right-click support (Task-List-style): the hook-bearing menu mounts on
    // the ROW's pointer-enter (which always precedes a right-click) and hands
    // its filtered items back via ref for the ContextMenuTrigger.
    const [menuActivated, setMenuActivated] = useState(false);
    const activateMenu = useCallback(() => setMenuActivated(true), []);
    const menuItemsRef = useRef<(() => MenuProps['items']) | null>(null);
    const handleMenuReady = useCallback((getItems: () => MenuProps['items']) => {
      menuItemsRef.current = getItems;
    }, []);
    const getContextMenuItems = useCallback(() => menuItemsRef.current?.() ?? [], []);

    const handleToggleSidebar = useCallback(
      (e: MouseEvent) => {
        e.stopPropagation();
        onToggleSidebar?.(item);
      },
      [item, onToggleSidebar],
    );

    return (
      <ContextMenuTrigger items={getContextMenuItems}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.row}
          gap={12}
          ref={setAnchor}
          onPointerEnter={activateMenu}
        >
          <WorkspaceLink
            aria-label={displayTitle}
            className={styles.identity}
            to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
          >
            <AgentAvatar item={item} size={28} />
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              {/* Single-line row (Linear-style density) — the description only
                renders in card mode, where there is room to browse. */}
              <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                <Text ellipsis className={'agent-row-title'} weight={500}>
                  {displayTitle}
                </Text>
                {roleTag ? (
                  <Tag size={'small'} style={{ flex: 'none' }}>
                    {roleTag}
                  </Tag>
                ) : null}
              </Flexbox>
            </Flexbox>
          </WorkspaceLink>
          {/* Trailing cluster (Task-list-style): label pills + author avatar +
            update time as one tight right-aligned group. */}
          <Flexbox
            horizontal
            align={'center'}
            flex={'none'}
            gap={8}
            justify={'flex-end'}
            style={{ maxWidth: 420, overflow: 'hidden' }}
          >
            <LabelTags labels={item.labels} />
            {showAuthor && (
              // The slot is reserved even without an author, so an unknown
              // author doesn't shift the row's label pills sideways.
              <Flexbox flex={'none'} style={{ width: AUTHOR_COL_WIDTH }}>
                {author && (
                  <Tooltip title={author.name}>
                    <Avatar avatar={author.avatar || DEFAULT_AVATAR} size={AUTHOR_COL_WIDTH} />
                  </Tooltip>
                )}
              </Flexbox>
            )}
            <Text
              className={styles.updatedAt}
              fontSize={12}
              title={updatedAt ? dayjs(updatedAt).format('YYYY-MM-DD HH:mm') : undefined}
            >
              {updatedAt ? formatUpdatedAt(updatedAt) : '–'}
            </Text>
          </Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            flex={'none'}
            gap={4}
            style={{ width: ACTION_COL_WIDTH }}
          >
            {onToggleSidebar && (
              <ActionIcon
                color={cssVar.colorTextSecondary}
                icon={sidebarHidden ? EyeOffIcon : EyeIcon}
                size={'small'}
                // Hidden agents read as faded, mirroring the customize-sidebar
                // modal's 0.5-opacity treatment of hidden rows.
                style={{ opacity: sidebarHidden ? 0.5 : undefined }}
                title={
                  sidebarHidden
                    ? t('agentViewAll.addToSidebar')
                    : t('agentViewAll.removeFromSidebar')
                }
                onClick={handleToggleSidebar}
              />
            )}
            {/* Headless: the row's context menu is the only actions entry. It
              carries the sidebar toggle too — the eye icon above is a fast
              single-click path, but right-click is where users look for the
              row's actions, and the toggle went missing there. */}
            <ItemActions
              hideTrigger
              anchor={anchor}
              forceActivated={menuActivated}
              includeSidebarToggle={Boolean(onToggleSidebar)}
              item={item}
              sidebarHidden={sidebarHidden}
              onMenuReady={handleMenuReady}
              onToggleSidebar={onToggleSidebar}
            />
          </Flexbox>
        </Flexbox>
      </ContextMenuTrigger>
    );
  },
);

AgentRow.displayName = 'AgentRow';

export default AgentRow;
