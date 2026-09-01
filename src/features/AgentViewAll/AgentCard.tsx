'use client';

import { AGENT_CHAT_URL, DEFAULT_AVATAR, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Block, ContextMenuTrigger, Flexbox, type MenuProps, Tooltip } from '@lobehub/ui';
import { Avatar, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, responsive } from 'antd-style';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import AgentAvatar from './AgentAvatar';
import { type AgentRowAuthor, formatUpdatedAt } from './AgentRow';
import ItemActions from './ItemActions';
import LabelTags from './LabelTags';

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
  /* Top-right "…" slot, a SIBLING of the card link (absolutely positioned
     over it) — nesting an interactive menu trigger inside the <a> would put
     a button inside a link in the accessibility tree. Aligned with the
     card's 12px padding so it sits where the header row used to hold it. */
  actions: css`
    position: absolute;
    inset-block-start: 12px;
    inset-inline-end: 12px;
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
    const { description, id, type, updatedAt } = item;
    // Groups have no personal name, so this resolves to their title.
    const displayTitle = agentDisplayName(item, t('agentViewAll.untitled'));
    const roleTag = agentSecondaryDisplayName(item);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    // Right-click support — same bridge as AgentRow: the hook-bearing menu
    // mounts on the card's pointer-enter and hands its items back via ref.
    const [menuActivated, setMenuActivated] = useState(false);
    const activateMenu = useCallback(() => setMenuActivated(true), []);
    const menuItemsRef = useRef<(() => MenuProps['items']) | null>(null);
    const handleMenuReady = useCallback((getItems: () => MenuProps['items']) => {
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
              {/* Right padding reserves the header slot the absolutely
                  positioned "…" sibling overlays. */}
              <Flexbox
                horizontal
                align={'center'}
                gap={8}
                style={{ minWidth: 0, paddingInlineEnd: 28 }}
              >
                <AgentAvatar item={item} size={24} />
                <Flexbox horizontal align={'center'} flex={1} gap={6} style={{ minWidth: 0 }}>
                  <Text ellipsis style={{ minWidth: 0 }} weight={600}>
                    {displayTitle}
                  </Text>
                  {roleTag ? (
                    <Tag size={'small'} style={{ flex: 'none' }}>
                      {roleTag}
                    </Tag>
                  ) : null}
                </Flexbox>
              </Flexbox>
              <Text className={cardStyles.description} fontSize={12} type={'secondary'}>
                {description}
              </Text>
              {item.labels?.length ? (
                <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
                  <LabelTags labels={item.labels} />
                </Flexbox>
              ) : null}
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
                      <Tooltip title={author.name}>
                        <Avatar avatar={author.avatar || DEFAULT_AVATAR} size={18} />
                      </Tooltip>
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
          <span className={cardStyles.actions}>
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
  },
);

AgentCard.displayName = 'AgentCard';

export default AgentCard;
