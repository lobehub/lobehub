'use client';

import { AGENT_CHAT_URL, DEFAULT_AVATAR, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { ContextMenuTrigger, type DropdownItem, Flexbox, Tooltip } from '@lobehub/ui';
import { ActionIcon, Avatar, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import ItemActions from './ItemActions';
import LabelTags from './LabelTags';
import { identityMarker } from './markers.stylex';
import SidebarItemAvatar from './SidebarItemAvatar';

/** Fixed action-column width (sidebar-eye toggle + "…" menu) so rows stay aligned. */
export const ACTION_COL_WIDTH = 64;

/** Author avatar slot — reserved even when the author is unknown. */
const AUTHOR_COL_WIDTH = 20;
export const NAME_COL_WIDTH = 240;
export const ROLE_COL_WIDTH = 200;

const styles = stylex.create({
  description: {
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: '0',
    minWidth: '180px',
    color: cssVar.colorTextTertiary,
    display: { 'default': null, '@container agent-row (width < 600px)': 'none' },
  },
  name: {
    flex: { 'default': `0 1 ${NAME_COL_WIDTH}px`, '@container agent-row (width < 600px)': '3 1 0' },
    minWidth: 0,
  },
  role: {
    flex: { 'default': `0 1 ${ROLE_COL_WIDTH}px`, '@container agent-row (width < 600px)': '2 1 0' },
    minWidth: 0,
    color: cssVar.colorTextSecondary,
  },
  // The link spans the name column (not the whole row) — a management list
  // is for scanning and acting, and a full-row link turns clicks on the
  // author / timestamp / action columns into a navigation. The name column
  // stays a generous target, including the space right of a short title.
  identity: {
    cursor: 'pointer',
    display: 'flex',
    flex: '1',
    gap: '12px',
    alignItems: 'center',
    minWidth: '0',
    color: 'inherit',
  },
  row: {
    containerName: 'agent-row',
    containerType: 'inline-size',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    color: 'inherit',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  title: {
    textDecorationLine: {
      default: null,
      [stylex.when.ancestor(':hover', identityMarker)]: 'underline',
    },
  },
  // Reserved width, right-aligned: "3 天前" and "2026-07-22" differ by ~30px,
  // and a content-sized column puts the author avatar and the label pills at a
  // different x on every row. `min-width` (not `width`) so an unusually long
  // relative string — en's "a few seconds ago" — grows instead of truncating.
  updatedAt: {
    flex: 'none',
    minWidth: '88px',
    color: cssVar.colorTextQuaternary,
    textAlign: 'end',
    whiteSpace: 'nowrap',
  },
});

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
    const { description, id, type, updatedAt } = item;
    // Groups have no personal name, so this resolves to their title.
    const displayTitle = agentDisplayName(item, t('agentViewAll.untitled'));
    const role = agentSecondaryDisplayName(item);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    // Right-click support (Task-List-style): the hook-bearing menu mounts on
    // the ROW's pointer-enter (which always precedes a right-click) and hands
    // its filtered items back via ref for the ContextMenuTrigger.
    const [menuActivated, setMenuActivated] = useState(false);
    const activateMenu = useCallback(() => setMenuActivated(true), []);
    const menuItemsRef = useRef<(() => DropdownItem[]) | null>(null);
    const handleMenuReady = useCallback((getItems: () => DropdownItem[]) => {
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
          className={stylex.props(styles.row).className}
          gap={12}
          ref={setAnchor}
          onPointerEnter={activateMenu}
        >
          <WorkspaceLink
            aria-label={displayTitle}
            className={stylex.props(styles.identity, identityMarker).className}
            to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
          >
            <SidebarItemAvatar item={item} size={28} />
            {/* Three single-line columns: who the agent is, the role it plays,
              and what it is responsible for. */}
            <Text
              ellipsis
              className={stylex.props(styles.title, styles.name).className}
              weight={500}
            >
              {displayTitle}
            </Text>
            <Text ellipsis className={stylex.props(styles.role).className} title={role}>
              {role}
            </Text>
            <Text
              ellipsis
              className={stylex.props(styles.description).className}
              title={description ?? undefined}
            >
              {description}
            </Text>
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
              className={stylex.props(styles.updatedAt).className}
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
            {/* Visible "…" trigger AND right-click open the same menu — the
              context menu alone proved undiscoverable (users assumed rows had
              no actions). The menu carries the sidebar toggle too; the eye
              icon stays as the fast single-click path. */}
            <ItemActions
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
