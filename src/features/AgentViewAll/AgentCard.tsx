'use client';

import { AGENT_CHAT_URL, DEFAULT_AVATAR, GROUP_CHAT_URL } from '@lobechat/const';
import { type SidebarAgentItem } from '@lobechat/types';
import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, responsive } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import AgentAvatar from './AgentAvatar';
import { type AgentRowAuthor, formatUpdatedAt } from './AgentRow';
import ItemActions from './ItemActions';

// Card layout mirrors the agent channel platform cards
// (src/routes/(main)/agent/channel/list.tsx): icon + title + trailing state on
// one row, a two-line description below, hover lift on the whole card.
export const cardStyles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: stretch;

    min-height: 104px;
    padding-block: 12px;
    padding-inline: 12px;

    transition:
      transform 0.18s,
      box-shadow 0.18s,
      border-color 0.18s;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgb(0 0 0 / 6%);
    }
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    line-height: 1.5;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;

    width: 100%;
    min-width: 0;

    ${responsive.md} {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    ${responsive.sm} {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  link: css`
    display: block;
    min-width: 0;
    color: inherit;
  `,
  updatedAt: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface AgentCardProps {
  /** Creator profile; rendered only when `showAuthor` is set. */
  author?: AgentRowAuthor | null;
  item: SidebarAgentItem;
  /** Toggle whether this item appears in the caller's sidebar. */
  onToggleSidebar?: (item: SidebarAgentItem) => void;
  /** Whether to render the author info (workspace mode). */
  showAuthor?: boolean;
  /** Whether the caller removed this item from their sidebar (default listed). */
  sidebarHidden?: boolean;
}

const AgentCard = memo<AgentCardProps>(
  ({ author, item, onToggleSidebar, showAuthor, sidebarHidden }) => {
    const { t } = useTranslation('common');
    const { description, id, title, type, updatedAt } = item;
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    return (
      <WorkspaceLink
        aria-label={title || undefined}
        className={cardStyles.link}
        ref={setAnchor}
        to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
      >
        <Block clickable className={cardStyles.card} height={'100%'} variant={'outlined'}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <AgentAvatar item={item} size={24} />
            <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={600}>
              {title || t('agentViewAll.untitled')}
            </Text>
            <Flexbox
              flex={'none'}
              onClick={(e) => {
                // Keep the menu from following the card link.
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <ItemActions
                includeSidebarToggle
                anchor={anchor}
                item={item}
                sidebarHidden={sidebarHidden}
                onToggleSidebar={onToggleSidebar}
              />
            </Flexbox>
          </Flexbox>
          <Text className={cardStyles.description} fontSize={12} type={'secondary'}>
            {description}
          </Text>
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            justify={'space-between'}
            style={{ marginBlockStart: 'auto' }}
          >
            {showAuthor ? (
              <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                {author ? (
                  <>
                    <Avatar avatar={author.avatar || DEFAULT_AVATAR} size={18} />
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
            ) : (
              <div />
            )}
            <Text className={cardStyles.updatedAt} fontSize={12}>
              {updatedAt ? formatUpdatedAt(updatedAt) : '–'}
            </Text>
          </Flexbox>
        </Block>
      </WorkspaceLink>
    );
  },
);

AgentCard.displayName = 'AgentCard';

export default AgentCard;
