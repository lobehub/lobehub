'use client';

import { AGENT_CHAT_URL, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Block, ContextMenuTrigger, type DropdownItem, Flexbox, Icon } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { AGENT_GRID_MIN_COLUMN } from './AgentCard';
import ItemActions from './ItemActions';
import SidebarItemAvatar from './SidebarItemAvatar';

// "In sidebar" overview: a collapsible card grid pinned above the main list
// so the user can see at a glance which agents currently show in the sidebar
// (mirrors the enabled-providers block on the provider settings page).
const styles = stylex.create({
  actions: { position: 'absolute', insetBlockStart: '0', insetInlineEnd: '0' },
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    alignItems: 'stretch',
    justifyContent: 'center',
    minHeight: '72px',
    paddingBlock: '10px',
    paddingInline: '12px',
    transition: 'transform 0.18s,\n      box-shadow 0.18s,\n      border-color 0.18s',
    transform: { 'default': null, ':hover': 'translateY(-1px)' },
    boxShadow: { 'default': null, ':hover': '0 4px 12px rgb(0 0 0 / 6%)' },
  },
  container: {
    padding: '12px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    lineHeight: 1.5,
  },
  grid: {
    display: 'grid',
    gap: '12px',
    width: '100%',
    minWidth: '0',
  },
  header: { cursor: 'pointer', userSelect: 'none' },
  gridColumns: (minColumn: number) => ({
    gridTemplateColumns: `repeat(auto-fill, minmax(min(${minColumn}px, 100%), 1fr))`,
  }),
  link: { display: 'block', minWidth: '0', color: 'inherit' },
});

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
  const menuItemsRef = useRef<(() => DropdownItem[]) | null>(null);
  const handleMenuReady = useCallback((getItems: () => DropdownItem[]) => {
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
        className={stylex.props(styles.link).className}
        ref={setAnchor}
        to={type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id, false)}
        onPointerEnter={activateMenu}
      >
        <Block
          clickable
          className={stylex.props(styles.card).className}
          height={'100%'}
          variant={'outlined'}
        >
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <SidebarItemAvatar item={item} size={24} />
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
            <Text
              className={stylex.props(styles.description).className}
              fontSize={12}
              type={'secondary'}
            >
              {description}
            </Text>
          ) : null}
          <span {...stylex.props(styles.actions)}>
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
    <Flexbox className={stylex.props(styles.container).className} gap={12}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
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
        <div {...stylex.props(styles.grid, styles.gridColumns(AGENT_GRID_MIN_COLUMN))}>
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
