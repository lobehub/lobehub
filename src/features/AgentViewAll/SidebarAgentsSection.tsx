'use client';

import { AGENT_CHAT_URL, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Block, ContextMenuTrigger, Flexbox, Icon, type MenuProps, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, responsive } from 'antd-style';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import AgentAvatar from './AgentAvatar';
import ItemActions from './ItemActions';

// "In sidebar" overview: a collapsible card grid pinned above the main list
// so the user can see at a glance which agents currently show in the sidebar
// (mirrors the enabled-providers block on the provider settings page).
const styles = createStaticStyles(({ css, cssVar }) => ({
  /* The headless ItemActions still renders an empty span; keeping it out of
     the flex flow stops it from claiming a `gap` and shifting the centering. */
  actions: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;
  `,
  card: css`
    position: relative;

    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: stretch;
    justify-content: center;

    /* Uniform height across the grid; a card without a description centers its
       title instead of leaving a hole where the description would be. */
    min-height: 72px;
    padding-block: 10px;
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
  container: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

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
  header: css`
    cursor: pointer;
    user-select: none;
  `,
  link: css`
    display: block;
    min-width: 0;
    color: inherit;
  `,
}));

interface SidebarMiniCardProps {
  item: SidebarAgentItem;
  onToggleSidebar?: (item: SidebarAgentItem) => void;
}

// Deliberately minimal (avatar + name + description only) — the block answers
// "what's in my sidebar", so the full card's labels/author/date are noise here.
// Actions live entirely in the right-click menu (same as rows/cards).
const SidebarMiniCard = memo<SidebarMiniCardProps>(({ item, onToggleSidebar }) => {
  const { t } = useTranslation('common');
  const { description, id, type } = item;
  // Groups have no personal name, so this resolves to their title.
  const displayTitle = agentDisplayName(item, t('agentViewAll.untitled'));
  const roleTag = agentSecondaryDisplayName(item);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const [menuActivated, setMenuActivated] = useState(false);
  const activateMenu = useCallback(() => setMenuActivated(true), []);
  const menuItemsRef = useRef<(() => MenuProps['items']) | null>(null);
  const handleMenuReady = useCallback((getItems: () => MenuProps['items']) => {
    menuItemsRef.current = getItems;
  }, []);
  const getContextMenuItems = useCallback(() => menuItemsRef.current?.() ?? [], []);

  return (
    <ContextMenuTrigger items={getContextMenuItems}>
      {/* Single child: the trigger wraps exactly one element, and the grid
          treats it as one cell. The headless ItemActions lives INSIDE it —
          rendering it as a sibling would add a phantom grid item. */}
      <WorkspaceLink
        aria-label={displayTitle}
        className={styles.link}
        ref={setAnchor}
        to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
        onPointerEnter={activateMenu}
      >
        <Block clickable className={styles.card} height={'100%'} variant={'outlined'}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <AgentAvatar item={item} size={24} />
            <Text ellipsis style={{ minWidth: 0 }} weight={600}>
              {displayTitle}
            </Text>
            {roleTag ? (
              <Tag size={'small'} style={{ flex: 'none' }}>
                {roleTag}
              </Tag>
            ) : null}
          </Flexbox>
          {description ? (
            <Text className={styles.description} fontSize={12} type={'secondary'}>
              {description}
            </Text>
          ) : null}
          <span className={styles.actions}>
            <ItemActions
              hideTrigger
              includeSidebarToggle
              anchor={anchor}
              forceActivated={menuActivated}
              item={item}
              sidebarHidden={false}
              onMenuReady={handleMenuReady}
              onToggleSidebar={onToggleSidebar}
            />
          </span>
        </Block>
      </WorkspaceLink>
    </ContextMenuTrigger>
  );
});

SidebarMiniCard.displayName = 'SidebarMiniCard';

interface SidebarAgentsSectionProps {
  items: SidebarAgentItem[];
  onToggleSidebar?: (item: SidebarAgentItem) => void;
}

const SidebarAgentsSection = memo<SidebarAgentsSectionProps>(({ items, onToggleSidebar }) => {
  const { t } = useTranslation('common');
  const collapsed = useGlobalStore(systemStatusSelectors.agentListSidebarSectionCollapsed);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const toggle = useCallback(
    () =>
      updateSystemStatus(
        { agentListSidebarSectionCollapsed: !collapsed },
        'toggleAgentListSidebarSection',
      ),
    [collapsed, updateSystemStatus],
  );

  return (
    <Flexbox className={styles.container} gap={12}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        gap={8}
        justify={'space-between'}
        onClick={toggle}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <Text fontSize={13} weight={500}>
            {t('agentViewAll.sidebarSection.title')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {items.length}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={4}>
          <Text fontSize={12} type={'secondary'}>
            {collapsed
              ? t('agentViewAll.sidebarSection.expand')
              : t('agentViewAll.sidebarSection.collapse')}
          </Text>
          <Icon
            color={cssVar.colorTextSecondary}
            icon={collapsed ? ChevronDownIcon : ChevronUpIcon}
            size={14}
          />
        </Flexbox>
      </Flexbox>
      {!collapsed && (
        <div className={styles.grid}>
          {items.map((item) => (
            <SidebarMiniCard item={item} key={item.id} onToggleSidebar={onToggleSidebar} />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

SidebarAgentsSection.displayName = 'SidebarAgentsSection';

export default SidebarAgentsSection;
