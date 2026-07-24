'use client';

import { AGENT_CHAT_URL, DEFAULT_AVATAR, GROUP_CHAT_URL } from '@lobechat/const';
import { type SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import AgentAvatar from './AgentAvatar';
import ItemActions from './ItemActions';

/** Shared column widths so the table header and rows stay aligned. */
export const AUTHOR_COL_WIDTH = 180;
export const TIME_COL_WIDTH = 130;
export const ACTION_COL_WIDTH = 88;

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    max-width: min(720px, 100%);
  `,
  row: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    color: inherit;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  updatedAt: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
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
    const { description, id, title, type, updatedAt } = item;
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    const handleToggleSidebar = useCallback(
      (e: MouseEvent) => {
        // Keep the toggle from following the row link.
        e.preventDefault();
        e.stopPropagation();
        onToggleSidebar?.(item);
      },
      [item, onToggleSidebar],
    );

    return (
      <WorkspaceLink
        aria-label={title || undefined}
        className={styles.row}
        ref={setAnchor}
        to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
      >
        <Flexbox horizontal align={'center'} gap={12}>
          <AgentAvatar item={item} size={36} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {title || t('agentViewAll.untitled')}
            </Text>
            {description && (
              <Text ellipsis className={styles.description} fontSize={12} type={'secondary'}>
                {description}
              </Text>
            )}
          </Flexbox>
          {showAuthor && (
            <Flexbox
              horizontal
              align={'center'}
              flex={'none'}
              gap={6}
              style={{ width: AUTHOR_COL_WIDTH }}
            >
              {author ? (
                <>
                  <Avatar avatar={author.avatar || DEFAULT_AVATAR} size={20} />
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {author.name}
                  </Text>
                </>
              ) : (
                <Text fontSize={12} type={'secondary'}>
                  –
                </Text>
              )}
            </Flexbox>
          )}
          <Text className={styles.updatedAt} fontSize={12} style={{ width: TIME_COL_WIDTH }}>
            {updatedAt ? formatUpdatedAt(updatedAt) : '–'}
          </Text>
          <Flexbox
            horizontal
            align={'center'}
            flex={'none'}
            gap={4}
            style={{ width: ACTION_COL_WIDTH }}
            onClick={(e) => {
              // Keep the actions from following the row link.
              e.preventDefault();
              e.stopPropagation();
            }}
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
            <ItemActions anchor={anchor} item={item} />
          </Flexbox>
        </Flexbox>
      </WorkspaceLink>
    );
  },
);

AgentRow.displayName = 'AgentRow';

export default AgentRow;
